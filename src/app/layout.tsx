import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Header from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Moon Wallet - Your Secure Crypto Wallet",
  description:
    "A secure and user-friendly cryptocurrency wallet for managing your digital assets",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-background h-full">
      <body
        className={cn(
          "min-h-screen font-sans antialiased",
          geistSans.variable,
          geistMono.variable,
        )}
        suppressHydrationWarning
      >
        <ProtectedRoute>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="relative flex-1">{children}</main>
          </div>
          <Toaster />
        </ProtectedRoute>
      </body>
    </html>
  );
}
