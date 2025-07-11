"use client";

import { Buffer } from "buffer";
import { Loader2, RefreshCw, Eye, EyeOff, CheckCircle, Shield, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { uniqueNamesGenerator, colors, animals, adjectives } from 'unique-names-generator';
import * as generator from 'generate-password';
import { motion, AnimatePresence } from "framer-motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { connection } from "@/lib/solana";
import { useWalletStore } from "@/store/walletStore";
import { compressPublicKey } from "@/utils/bufferUtils";
import { getMultisigPDA } from "@/utils/credentialUtils";
import { hashRecoveryPhrase } from "@/utils/guardianUtils";
import { createWebAuthnCredential } from "@/utils/webauthnUtils";
import { saveWebAuthnCredentialMapping } from "@/lib/firebase/webAuthnService";
import { checkGuardianNameExists } from "@/lib/firebase/guardianService";
import { Switch } from "@/components/ui/switch";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger 
} from "@/components/ui/tooltip";

export default function CreateWallet() {
  const router = useRouter();
  const [walletName, setWalletName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [threshold, setThreshold] = useState(1);
  const MAX_ALLOWED_THRESHOLD = 8;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState<"setup" | "review">("setup");
  const { setMultisigPDA, setWalletData } = useWalletStore();
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [autoGenerated, setAutoGenerated] = useState(true);
  
  // CSS animation cho text shine effect
  const shineAnimation = {
    background: "linear-gradient(to right, #3B82F6 20%, #6366F1 30%, #818CF8 70%, #3B82F6 80%)",
    backgroundSize: "200% auto",
    color: "transparent",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    animation: "shine 3s linear infinite",
    display: "inline-block",
    textShadow: "0 0 8px rgba(59, 130, 246, 0.5)"
  };

  // Tạo tên ví ngẫu nhiên
  const generateRandomName = () => {
    const randomName = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: '',
      style: 'capital'
    });
    return randomName;
  };

  // Tạo mật khẩu ngẫu nhiên
  const generateRandomPassword = () => {
    return generator.generate({
      length: 18,
      numbers: true,
      symbols: true,
      uppercase: true,
      strict: true
    });
  };

  // Tạo dữ liệu tự động khi khởi tạo component
  useEffect(() => {
    if (autoGenerated) {
      const newName = generateRandomName();
      setWalletName(newName);
      setRecoveryPhrase(generateRandomPassword());
      checkDuplicateName(newName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Làm mới tên ví và mật khẩu
  const refreshRandomData = () => {
    const newName = generateRandomName();
    setWalletName(newName);
    setRecoveryPhrase(generateRandomPassword());
    checkDuplicateName(newName);
  };
  
  const checkDuplicateName = async (name: string) => {
    if (!name) return;
    
    setIsCheckingName(true);
    setNameError("");
    
    try {
      const exists = await checkGuardianNameExists(name);
      if (exists) {
        setNameError("This guardian name already exists. Please choose another name.");
      }
    } catch (error) {
      console.error("Error checking name:", error);
    } finally {
      setIsCheckingName(false);
    }
  };

  const handleCreateWallet = async () => {
    try {
      setIsLoading(true);
      setError("");

      // Kiểm tra tên guardian trùng lặp
      const exists = await checkGuardianNameExists(walletName);
      if (exists) {
        setNameError("This guardian name already exists. Please choose another name.");
        setIsLoading(false);
        return;
      }

      // Kiểm tra ngưỡng ký không vượt quá MAX_ALLOWED_THRESHOLD
      const validThreshold = Math.min(threshold, MAX_ALLOWED_THRESHOLD);
      
      const result = await createWebAuthnCredential(walletName);
      const rawIdBase64 = Buffer.from(result.rawId).toString("base64");

      const multisigPDA = getMultisigPDA(rawIdBase64);

      const walletResponse = await fetch("/api/wallet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold: validThreshold,
          credentialId: rawIdBase64,
          name: walletName,
          multisigPDA: multisigPDA.toString(),
        }),
      });

      if (!walletResponse.ok) {
        const errorData = await walletResponse.json();
        throw new Error(
          `Failed to create wallet: ${errorData.error || "Unknown error"}`,
        );
      }

      const walletData = await walletResponse.json();
      await connection.confirmTransaction(walletData.signature);

      const recoveryHashIntermediate = await hashRecoveryPhrase(recoveryPhrase);

      const uncompressedKeyBuffer = Buffer.from(result.publicKey, "hex");
      const compressedKeyBuffer = compressPublicKey(uncompressedKeyBuffer);

      // Thêm guardian chính (owner)
      const guardianResponse = await fetch("/api/guardian/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guardianId: 1,
          guardianName: walletName || "Owner",
          recoveryHashIntermediate: Array.from(recoveryHashIntermediate),
          webauthnPubkey: Array.from(compressedKeyBuffer),
          webauthnCredentialId: rawIdBase64,
          multisigPDA: multisigPDA.toString(),
          isInitialOwner: true
        }),
      });

      if (!guardianResponse.ok) {
        const errorData = await guardianResponse.json();
        throw new Error(
          `Failed to add guardian: ${errorData.error || "Unknown error"}`,
        );
      }

      await guardianResponse.json();
      
      const webauthnMapping = {
              credentialId: rawIdBase64,
              walletAddress: multisigPDA.toString(),
              guardianPublicKey: Array.from(
                new Uint8Array(compressedKeyBuffer)
              ),
              guardianId: 1
            };

            localStorage.setItem('current_credential_id', rawIdBase64);

            localStorage.setItem(
              "webauthn_credential_" + rawIdBase64,
              JSON.stringify(webauthnMapping)
            );

      await saveWebAuthnCredentialMapping(
        rawIdBase64,             // credential ID
        multisigPDA.toString(),  // địa chỉ ví
        Array.from(new Uint8Array(compressedKeyBuffer)), // public key
        1,                       // guardianId = 1 (owner)
        walletName,              // Thêm walletName 
        validThreshold            // Thêm threshold
      );

      setMultisigPDA(multisigPDA.toString());
      setWalletData({
        walletName,
        threshold: validThreshold,
        guardianCount: 1, // Ban đầu chỉ có 1 guardian (owner)
        lastUpdated: Date.now(),
      });

      router.push("/dashboard");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-blue-800/50 bg-gradient-to-b from-[#0e162a] to-[#131f38] shadow-xl shadow-blue-900/20 backdrop-blur-sm overflow-hidden relative">
      {/* Background gradient effect that changes with step */}
      <motion.div 
        className="absolute inset-0 opacity-25 -z-10"
        animate={{ 
          background: currentStep === "setup" 
            ? "radial-gradient(circle at top right, rgba(59, 130, 246, 0.5), rgba(37, 99, 235, 0.15))" 
            : "radial-gradient(circle at bottom left, rgba(99, 102, 241, 0.5), rgba(79, 70, 229, 0.15))"
        }}
        transition={{ duration: 0.8 }}
      />
      
      {/* Animated particles */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute top-20 left-10 h-2 w-2 rounded-full bg-blue-400 animate-ping" style={{animationDuration: "3s", animationDelay: "0.2s"}} />
        <div className="absolute top-40 right-12 h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" style={{animationDuration: "4s", animationDelay: "1s"}} />
        <div className="absolute bottom-20 left-1/4 h-1 w-1 rounded-full bg-purple-400 animate-ping" style={{animationDuration: "5s", animationDelay: "0.5s"}} />
        <div className="absolute bottom-40 right-1/3 h-1 w-1 rounded-full bg-blue-300 animate-ping" style={{animationDuration: "6s", animationDelay: "1.5s"}} />
      </div>

      <div className="p-6 md:p-8 relative">
        {/* Progress indicator */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex space-x-3">
              <motion.div
                className={`h-3 w-3 rounded-full ${currentStep === "setup" ? "bg-gradient-to-r from-blue-400 to-blue-600 shadow-md shadow-blue-500/50" : "bg-gray-600"}`}
                animate={{ scale: currentStep === "setup" ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 0.5, repeat: currentStep === "setup" ? Infinity : 0, repeatDelay: 4 }}
              />
              <motion.div
                className={`h-3 w-3 rounded-full ${currentStep === "review" ? "bg-gradient-to-r from-blue-400 to-indigo-600 shadow-md shadow-indigo-500/50" : "bg-gray-600"}`}
                animate={{ scale: currentStep === "review" ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 0.5, repeat: currentStep === "review" ? Infinity : 0, repeatDelay: 4 }}
              />
            </div>
            <motion.div 
              className="text-sm text-blue-300 bg-blue-900/20 px-3 py-1 rounded-full border border-blue-800/30 backdrop-blur-sm"
              whileHover={{ y: -2 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              Step {currentStep === "setup" ? "1" : "2"} / 2
            </motion.div>
            </div>
          <div className="h-1.5 w-full bg-blue-900/40 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-indigo-500 shadow-inner shadow-blue-500/30"
              animate={{ width: currentStep === "setup" ? "50%" : "100%" }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {currentStep === "setup" && (
            <motion.div 
              className="space-y-6"
              key="setup"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.5 }}
            >
              <div className="flex items-center justify-between mb-8">
            <div>
                  <motion.h2 
                    className="mb-2 text-2xl font-bold"
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    style={shineAnimation}
                  >
                    Set Up Your Wallet
                  </motion.h2>
                  <motion.p 
                    className="text-sm text-white"
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    style={{ textShadow: "0 0 5px rgba(255, 255, 255, 0.3)" }}
                  >
                    Create your wallet name, recovery password and security configuration
                  </motion.p>
                </div>
                <motion.div 
                  className="flex items-center gap-2 bg-blue-900/60 px-3 py-2 rounded-lg border border-blue-700/50 shadow-md"
                  initial={{ x: 10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  whileHover={{ scale: 1.03 }}
                  transition={{ delay: 0.3 }}
                >
                  <p className="text-sm text-white font-medium">Auto Generate</p>
                  <Switch 
                    checked={autoGenerated} 
                    onCheckedChange={(checked: boolean) => {
                      setAutoGenerated(checked);
                      if (checked) {
                        refreshRandomData();
                      } else {
                        setWalletName("");
                        setRecoveryPhrase("");
                      }
                    }}
                  />
                </motion.div>
            </div>

              <div className="space-y-6">
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-sm font-medium text-white">
                  Wallet Name
                </label>
                    {autoGenerated && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <motion.div whileHover={{ rotate: 180 }} transition={{ duration: 0.3 }}>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={refreshRandomData}
                                className="h-8 w-8 p-0 text-blue-300 hover:text-blue-200 hover:bg-blue-900/40 rounded-full"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </motion.div>
                          </TooltipTrigger>
                          <TooltipContent className="bg-blue-900/90 text-blue-100 border-blue-800">
                            <p>Generate new name and password</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <motion.div 
                    className="relative"
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  >
                <Input
                      placeholder="Enter your wallet name"
                  value={walletName}
                  onChange={(e) => {
                    setWalletName(e.target.value);
                    setNameError("");
                  }}
                  onBlur={() => checkDuplicateName(walletName)}
                  maxLength={32}
                      className="h-12 bg-blue-950/70 border-blue-700/50 text-white placeholder:text-gray-400 focus-visible:ring-blue-400 focus-visible:border-blue-400 rounded-lg shadow-inner shadow-blue-950/50 pl-4"
                      disabled={isCheckingName}
                    />
                    {walletName && (
                      <motion.div 
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-400"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </motion.div>
                    )}
                  </motion.div>
                {nameError && (
                    <motion.p 
                      className="mt-2 text-sm text-red-400 flex items-center"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {nameError}
                    </motion.p>
                )}
                {isCheckingName && (
                    <motion.p 
                      className="mt-2 text-sm text-blue-400 flex items-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      Checking name...
                    </motion.p>
                )}
                </motion.div>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  <label className="mb-1.5 block text-sm font-medium text-white">
                    Recovery Password
                </label>
                  <motion.div 
                    className="relative"
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  >
                <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter recovery password"
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  maxLength={32}
                      className="h-12 font-mono pr-10 bg-blue-950/70 border-blue-700/50 text-white placeholder:text-gray-400 focus-visible:ring-blue-400 focus-visible:border-blue-400 rounded-lg shadow-inner shadow-blue-950/50 pl-4"
                />
                    <motion.button
                      type="button"
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-blue-300"
                      onClick={() => setShowPassword(!showPassword)}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </motion.button>
                  </motion.div>
                  <p className="mt-2 text-xs text-white bg-blue-900/40 p-3 rounded border border-blue-700/30 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    This password will be used to recover your wallet. Keep it safe.
                  </p>
                </motion.div>
            </div>

              {/* Phần chọn ngưỡng xác nhận */}
              <motion.div 
                className="space-y-4 mt-6 bg-gradient-to-r from-blue-900/20 to-indigo-900/20 p-4 rounded-xl border border-blue-800/30"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
              <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="bg-blue-800/70 p-2 rounded-lg mr-3 shadow-md">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    </div>
                    <h3 className="font-medium text-white">Signature Threshold</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <motion.button 
                      className="w-6 h-6 rounded-full bg-blue-800/70 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                      onClick={() => setThreshold(Math.max(1, threshold - 1))}
                      disabled={threshold <= 1}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      -
                    </motion.button>
                    <span className="text-sm text-white bg-blue-800/70 px-3 py-1 rounded-lg min-w-[60px] text-center font-medium shadow-md">
                      {threshold} / {MAX_ALLOWED_THRESHOLD}
                    </span>
                    <motion.button 
                      className="w-6 h-6 rounded-full bg-blue-800/70 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                      onClick={() => setThreshold(Math.min(MAX_ALLOWED_THRESHOLD, threshold + 1))}
                      disabled={threshold >= MAX_ALLOWED_THRESHOLD}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      +
                    </motion.button>
                  </div>
              </div>
              <Slider
                value={[threshold]}
                min={1}
                max={MAX_ALLOWED_THRESHOLD}
                step={1}
                onValueChange={(value) => setThreshold(value[0])}
                className="w-full"
              />
                <p className="text-sm text-white">
                  Number of signatures required to confirm transactions
                </p>
                {threshold > 1 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="text-xs text-amber-300 italic flex items-start p-2 bg-amber-900/10 rounded border border-amber-800/20">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>
                        <strong>Important note:</strong> With a threshold of {threshold}, you&apos;ll need to invite at least {threshold - 1} additional guardians
                        after creating the wallet to be able to execute transactions.
                      </span>
                    </p>
                  </motion.div>
                )}
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <Alert className="border-blue-700/50 bg-blue-800/50 backdrop-blur-sm shadow-lg">
                  <Info className="h-5 w-5 text-blue-300 flex-shrink-0 mr-2" strokeWidth={2} />
                  <AlertDescription className="text-white">
                    You can add members and adjust signature threshold after creating the wallet
              </AlertDescription>
            </Alert>
              </motion.div>

              <motion.div 
                className="mt-auto pt-6"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
              >
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="relative group"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl blur opacity-50 group-hover:opacity-80 transition duration-300"></div>
              <Button
                    className="h-14 w-full text-base font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transition-all duration-300 shadow-lg shadow-blue-900/30 border-0 relative rounded-xl"
                onClick={() => setCurrentStep("review")}
                    disabled={!walletName || !!nameError || !recoveryPhrase}
              >
                    Continue
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 11H5a1 1 0 110-2h7.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
              </Button>
                </motion.div>
              </motion.div>
            </motion.div>
        )}

        {currentStep === "review" && (
            <motion.div 
              className="space-y-6"
              key="review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.5 }}
            >
              <div className="flex items-center mb-6">
                <div className="h-12 w-12 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg mr-4 p-0.5">
                  <div className="h-full w-full rounded-full bg-blue-950 flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-blue-300" />
                  </div>
                </div>
            <div>
                  <h2 className="text-2xl font-bold mb-1" style={shineAnimation}>
                    Review & Create Wallet
                  </h2>
                  <p className="text-sm text-white" style={{ textShadow: "0 0 5px rgba(255, 255, 255, 0.3)" }}>
                    Check your wallet configuration before creating
              </p>
            </div>
              </div>

              <motion.div 
                className="rounded-lg bg-gradient-to-r from-blue-900/20 to-blue-950/30 border border-blue-800/30 p-5 backdrop-blur-sm"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                whileHover={{ y: -3 }}
              >
                <div className="mb-2 text-blue-300 text-xs uppercase tracking-wider font-medium">Wallet Name</div>
                <div className="bg-blue-950/50 rounded-lg p-3 border border-blue-900/30">
                  <h3 className="text-xl font-semibold text-white">{walletName}</h3>
                </div>
              </motion.div>
              
              <motion.div 
                className="rounded-lg bg-gradient-to-r from-blue-900/20 to-blue-950/30 border border-blue-800/30 p-5 backdrop-blur-sm"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                whileHover={{ y: -3 }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-blue-300 text-xs uppercase tracking-wider font-medium">Recovery Password</div>
                  <motion.button
                    type="button"
                    className="text-gray-400 hover:text-blue-300 bg-blue-900/40 p-1.5 rounded-md"
                    onClick={() => setShowPassword(!showPassword)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </motion.button>
                </div>
                <div className="font-mono break-all text-sm bg-blue-950/50 text-gray-200 p-3 rounded-lg border border-blue-900/30 shadow-inner">
                  {showPassword ? recoveryPhrase : recoveryPhrase.replace(/./g, '•')}
                </div>
                <div className="mt-3 flex items-start p-2.5 bg-amber-900/10 rounded border border-amber-800/20">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-amber-300">
                    <strong>Important:</strong> Save this password! It will help you recover your wallet if needed.
                  </p>
            </div>
              </motion.div>

            <div className="grid grid-cols-3 gap-4">
                <motion.div 
                  className="rounded-lg bg-gradient-to-b from-blue-900/30 to-blue-950/40 border border-blue-800/30 p-4 backdrop-blur-sm relative overflow-hidden"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                >
                  <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-blue-500/5 blur-2xl"></div>
                  <p className="text-3xl font-bold text-white mb-1">1</p>
                  <p className="text-sm text-blue-300">
                    Members
                </p>
                </motion.div>
                <motion.div 
                  className="rounded-lg bg-gradient-to-b from-blue-900/30 to-blue-950/40 border border-blue-800/30 p-4 backdrop-blur-sm relative overflow-hidden"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                >
                  <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-indigo-500/5 blur-2xl"></div>
                  <p className="text-3xl font-bold text-white mb-1">{threshold}/{MAX_ALLOWED_THRESHOLD}</p>
                  <p className="text-sm text-blue-300">
                    Threshold
                </p>
                </motion.div>
                <motion.div 
                  className="rounded-lg bg-gradient-to-b from-blue-900/30 to-blue-950/40 border border-blue-800/30 p-4 backdrop-blur-sm relative overflow-hidden"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                >
                  <div className="absolute -right-4 -bottom-4 h-20 w-20 rounded-full bg-purple-500/5 blur-2xl"></div>
                  <p className="text-3xl font-bold text-white mb-1">Free</p>
                  <p className="text-sm text-blue-300">
                    Fee (SOL)
                </p>
                </motion.div>
            </div>

            {threshold > 1 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: 0.6 }}
                  className="overflow-hidden"
                >
                  <Alert className="border-amber-800/30 bg-amber-900/20 backdrop-blur-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-300 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <AlertDescription className="text-amber-300">
                      <strong>Note:</strong> With a threshold of {threshold}, you&apos;ll need to invite at least {threshold - 1} additional guardians 
                      after creating the wallet to be able to execute transactions.
                </AlertDescription>
              </Alert>
                </motion.div>
            )}

            {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                >
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
                </motion.div>
            )}

              <div className="flex space-x-4 pt-4">
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1"
                >
              <Button
                variant="outline"
                    className="h-14 w-full border-blue-700/30 bg-blue-900/10 backdrop-blur-sm text-blue-300 hover:bg-blue-800/20 rounded-xl"
                    onClick={() => setCurrentStep("setup")}
              >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
                    </svg>
                    Back
              </Button>
                </motion.div>
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 relative group"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl blur opacity-50 group-hover:opacity-80 transition duration-300"></div>
              <Button
                    className="h-14 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transition-all duration-300 shadow-lg shadow-blue-900/30 border-0 relative rounded-xl font-medium"
                onClick={handleCreateWallet}
                disabled={isLoading}
              >
                {isLoading ? (
                      <div className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating wallet...
                      </div>
                ) : (
                      <div className="flex items-center justify-center">
                        <Shield className="mr-2 h-5 w-5" />
                        Create Wallet
                      </div>
                )}
              </Button>
                </motion.div>
            </div>
            </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );
}
