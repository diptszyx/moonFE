use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::instructions::wallet::process_credential_id_seed;
use anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked;
use anchor_lang::solana_program::hash::hash;
use std::str::FromStr;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};

#[derive(Accounts)]
#[instruction(proposal_id: u64, description: String, proposer_guardian_id: u64)]
pub struct CreateProposal<'info> {
    #[account(
        mut,
        seeds = [b"multisig".as_ref(), &process_credential_id_seed(&multisig.credential_id)],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, MultiSigWallet>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + 
                32 +    
                8 +  
                32 +  
                4 + description.len() + 
                4 + 15 + 
                1 + 8 + 32 + 32 + 
                1 +  
                8 +  
                1 + 8 + 
                1 +  
                1 +  
                1,    
        seeds = [
            b"proposal".as_ref(), 
            multisig.key().as_ref(), 
            &proposal_id.to_le_bytes()
        ],
        bump
    )]
    pub proposal: Account<'info, TransactionProposal>,
    
    #[account(
        seeds = [b"guardian".as_ref(), multisig.key().as_ref(), &proposer_guardian_id.to_le_bytes()],
        bump = proposer_guardian.bump
    )]
    pub proposer_guardian: Account<'info, Guardian>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

pub fn create_proposal(
    ctx: Context<CreateProposal>, 
    proposal_id: u64,
    description: String,
    _proposer_guardian_id: u64,
    action: String,
    params: ActionParams
) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let proposer_guardian = &ctx.accounts.proposer_guardian;
    let clock = &ctx.accounts.clock;
    
    require!(
        proposer_guardian.is_active == true,
        WalletError::InactiveGuardian
    );
    
    require!(
        action == "transfer" || action == "transfer_token",
        WalletError::UnsupportedAction
    );
    
    match action.as_str() {
        "transfer" => {
            require!(
                params.amount.is_some() && params.destination.is_some(),
                WalletError::InvalidOperation
            );
        },
        "transfer_token" => {
            require!(
                params.token_mint.is_some() && params.token_amount.is_some() && params.destination.is_some(),
                WalletError::InvalidOperation
            );
        },
        _ => return Err(WalletError::UnsupportedAction.into())
    }
    
    let proposal = &mut ctx.accounts.proposal;
    
    proposal.multisig = multisig.key();
    proposal.proposal_id = proposal_id;
    proposal.proposer = proposer_guardian.key();
    proposal.description = description;
    proposal.action = action;
    proposal.params = params;
    proposal.status = ProposalStatus::Pending;
    proposal.created_at = clock.unix_timestamp;
    proposal.executed_at = None;
    proposal.signatures_count = 0; 
    proposal.required_signatures = multisig.threshold;
    proposal.bump = ctx.bumps.proposal;
    
    msg!("Đã tạo đề xuất mới với ID: {}", proposal_id);
    msg!("Hành động: {}", proposal.action);
    if let Some(amount) = proposal.params.amount {
        msg!("Số lượng SOL: {}", amount as f64 / 1_000_000_000.0);
    }
    if let Some(token_amount) = proposal.params.token_amount {
        msg!("Số lượng token: {}", token_amount);
    }
    if let Some(token_mint) = proposal.params.token_mint {
        msg!("Token mint: {}", token_mint);
    }
    if let Some(destination) = proposal.params.destination {
        msg!("Đích đến: {}", destination);
    }
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(proposal_id: u64, guardian_id: u64, timestamp: i64)]
pub struct ApproveProposal<'info> {
    #[account(mut)]
    pub multisig: Account<'info, MultiSigWallet>,
    
    #[account(
        mut,
        seeds = [
            b"proposal".as_ref(), 
            multisig.key().as_ref(), 
            &proposal_id.to_le_bytes()
        ],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Pending @ WalletError::InvalidOperation,
        constraint = *multisig.to_account_info().key == proposal.multisig @ WalletError::MultisigMismatch
    )]
    pub proposal: Account<'info, TransactionProposal>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + 
                32 +  
                8 +  
                8 +  
                1,    
        seeds = [
            b"signature".as_ref(),
            proposal.key().as_ref(),
            &guardian_id.to_le_bytes()
        ],
        bump
    )]
    pub signature: Account<'info, ProposalSignature>,
    
    #[account(
        seeds = [b"guardian".as_ref(), multisig.key().as_ref(), &guardian_id.to_le_bytes()],
        bump = guardian.bump,
        constraint = guardian.is_active @ WalletError::InactiveGuardian
    )]
    pub guardian: Account<'info, Guardian>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,
    
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}


fn standardize_pubkey(pubkey: &[u8; 33]) -> [u8; 33] {

    msg!("Standardizing pubkey: {}", to_hex(pubkey));
    
    *pubkey
}

pub fn approve_proposal(
    ctx: Context<ApproveProposal>, 
    proposal_id: u64,
    guardian_id: u64,
    timestamp: i64,
    message: Vec<u8>
) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;
    let signature = &mut ctx.accounts.signature;
    let guardian = &ctx.accounts.guardian;
    let clock = &ctx.accounts.clock;
    
    msg!("Bắt đầu phê duyệt đề xuất với ID: {}", proposal_id);
    msg!("Địa chỉ multisig: {}", multisig.key());
    msg!("Guardian ID: {}", guardian_id);
    msg!("Timestamp: {}", timestamp);
    
    require!(
        *multisig.to_account_info().owner == crate::ID,
        WalletError::InvalidOwner
    );
    
    require!(
        timestamp <= clock.unix_timestamp + 60, 
        WalletError::FutureTimestamp
    );
    
    require!(
        timestamp >= clock.unix_timestamp - 300,
        WalletError::ExpiredTimestamp
    );
    
    if let Some(webauthn_pubkey) = guardian.webauthn_pubkey {
        msg!("Guardian có WebAuthn public key: {}", to_hex(&webauthn_pubkey));
        
        let instruction_sysvar = &ctx.accounts.instruction_sysvar;
        require!(
            !instruction_sysvar.data_is_empty(),
            WalletError::InstructionMissing
        );
        
        let secp_ix = load_instruction_at_checked(0, instruction_sysvar)?;
        
        let secp256r1_verify_id = Pubkey::from_str("Secp256r1SigVerify1111111111111111111111111").unwrap();
        require!(
            secp_ix.program_id == secp256r1_verify_id,
            WalletError::InvalidSignatureVerification
        );
        
        let pk_in_ix = extract_public_key_from_secp_instruction(&secp_ix.data)?;
        
        msg!("Public key từ instruction: {}", to_hex(&pk_in_ix));
        
        require!(
            pk_in_ix == webauthn_pubkey,
            WalletError::PublicKeyMismatch
        );
        
        let standardized_pubkey = standardize_pubkey(&webauthn_pubkey);
        msg!("Standardized public key: {}", to_hex(&standardized_pubkey));
        
        let pubkey_hash = hash(&standardized_pubkey).to_bytes();
        let pubkey_hash_hex = to_hex(&pubkey_hash[0..6]);
        msg!("Public key hash after standardization: {}", pubkey_hash_hex);
        
        let expected_message = format!(
            "approve:proposal_{},guardian_{},timestamp:{},pubkey:{}",
            proposal_id,
            guardian_id,
            timestamp,
            pubkey_hash_hex
        );
        
        msg!("Expected message: {}", expected_message);
        msg!("Received message length: {}", message.len());
        msg!("Received message: {}", String::from_utf8_lossy(&message));
        
        if expected_message.as_bytes().len() == message.len() {
            for (i, (exp, rec)) in expected_message.as_bytes().iter().zip(message.iter()).enumerate() {
                if exp != rec {
                    msg!("Khác biệt tại vị trí [{}]: Expected {} ({}), Received {} ({})", 
                        i, exp, char::from(*exp), rec, char::from(*rec));
                }
            }
        }
        
        require!(
            message == expected_message.as_bytes(),
            WalletError::MessageMismatch
        );
    }
    
    signature.proposal = proposal.key();
    signature.guardian_id = guardian_id;
    signature.signature_time = clock.unix_timestamp;
    signature.bump = ctx.bumps.signature;
    
    proposal.signatures_count += 1;
    
    msg!("Guardian {} đã phê duyệt đề xuất {}", guardian_id, proposal_id);
    
    Ok(())
}


fn extract_public_key_from_secp_instruction(data: &[u8]) -> Result<[u8; 33]> {
    if data.len() < 16 {
        return Err(WalletError::InvalidInstructionData.into());
    }
    
    let num_signatures = data[0] as usize;
    if num_signatures != 1 {
        return Err(WalletError::InvalidSignatureCount.into());
    }
    
    let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    
    let mut pk = [0u8; 33];
    if data.len() < public_key_offset + 33 {
        return Err(WalletError::InvalidInstructionData.into());
    }
    
    pk.copy_from_slice(&data[public_key_offset..public_key_offset + 33]);
    Ok(pk)
}


fn to_hex(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let hex = format!("{:02x}", byte);
        result.push_str(&hex);
    }
    result
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub multisig: Account<'info, MultiSigWallet>,
    
    #[account(
        mut,
        seeds = [
            b"proposal".as_ref(), 
            multisig.key().as_ref(), 
            &proposal_id.to_le_bytes()
        ],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Pending @ WalletError::InvalidOperation,
        constraint = proposal.signatures_count >= proposal.required_signatures @ WalletError::InvalidOperation,
        constraint = *multisig.to_account_info().key == proposal.multisig @ WalletError::MultisigMismatch
    )]
    pub proposal: Account<'info, TransactionProposal>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(mut)]
    pub destination: AccountInfo<'info>,
    
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

// Tạo một cấu trúc riêng cho giao dịch token
#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ExecuteTokenProposal<'info> {
    #[account(mut)]
    pub multisig: Account<'info, MultiSigWallet>,
    
    #[account(
        mut,
        seeds = [
            b"proposal".as_ref(), 
            multisig.key().as_ref(), 
            &proposal_id.to_le_bytes()
        ],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Pending @ WalletError::InvalidOperation,
        constraint = proposal.signatures_count >= proposal.required_signatures @ WalletError::InvalidOperation,
        constraint = *multisig.to_account_info().key == proposal.multisig @ WalletError::MultisigMismatch,
        constraint = proposal.action == "transfer_token" @ WalletError::InvalidOperation
    )]
    pub proposal: Account<'info, TransactionProposal>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(mut)]
    pub destination: AccountInfo<'info>,
    
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

pub fn execute_proposal(
    ctx: Context<ExecuteProposal>,
    proposal_id: u64
) -> Result<()> {
    let multisig_credential_id = ctx.accounts.multisig.credential_id.clone();
    let multisig_bump = ctx.accounts.multisig.bump;
    
    let multisig = &mut ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;
    let clock = &ctx.accounts.clock;
    
    require!(
        *multisig.to_account_info().owner == crate::ID,
        WalletError::InvalidOwner
    );
    
    require!(
        proposal.signatures_count >= proposal.required_signatures,
        WalletError::InvalidOperation
    );
    
    msg!("Thực thi đề xuất chuyển SOL với ID: {}", proposal_id);
    msg!("Địa chỉ multisig: {}", multisig.key());
    msg!("Số chữ ký hiện tại: {}/{}", proposal.signatures_count, proposal.required_signatures);
    
    // Chỉ xử lý đề xuất chuyển SOL trong hàm này
    require!(
        proposal.action == "transfer",
        WalletError::UnsupportedAction
    );
    
    let destination = ctx.accounts.destination.key();
    let params_destination = proposal.params.destination.ok_or(WalletError::InvalidOperation)?;
    
    require!(
        params_destination == destination,
        WalletError::InvalidOperation
    );
    
    let amount = proposal.params.amount.ok_or(WalletError::InvalidOperation)?;
    
    let multisig_info = multisig.to_account_info();
    let credential_id_bytes = process_credential_id_seed(&multisig_credential_id);
    let _seeds = &[
        b"multisig".as_ref(),
        &credential_id_bytes,
        &[multisig_bump]
    ];
    
    let dest_starting_lamports = ctx.accounts.destination.lamports();
    **ctx.accounts.destination.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(amount)
        .ok_or(WalletError::ArithmeticOverflow)?;
    
    let multisig_starting_lamports = multisig_info.lamports();
    **multisig_info.lamports.borrow_mut() = multisig_starting_lamports
        .checked_sub(amount)
        .ok_or(WalletError::InsufficientFunds)?;
    
    msg!("Đã chuyển {} SOL đến {}", amount as f64 / 1_000_000_000.0, destination);
    
    // Cập nhật trạng thái đề xuất
    proposal.status = ProposalStatus::Executed;
    proposal.executed_at = Some(clock.unix_timestamp);
    
    multisig.transaction_nonce += 1;
    multisig.last_transaction_timestamp = clock.unix_timestamp;
    
    msg!("Đã thực thi đề xuất {} thành công", proposal_id);
    
    Ok(())
}

// Thêm hàm mới để xử lý đề xuất chuyển token
pub fn execute_token_proposal(
    ctx: Context<ExecuteTokenProposal>,
    proposal_id: u64
) -> Result<()> {
    let multisig_credential_id = ctx.accounts.multisig.credential_id.clone();
    let multisig_bump = ctx.accounts.multisig.bump;
    
    let multisig = &mut ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;
    let clock = &ctx.accounts.clock;
    
    require!(
        *multisig.to_account_info().owner == crate::ID,
        WalletError::InvalidOwner
    );
    
    require!(
        proposal.signatures_count >= proposal.required_signatures,
        WalletError::InvalidOperation
    );
    
    msg!("Thực thi đề xuất chuyển token với ID: {}", proposal_id);
    msg!("Địa chỉ multisig: {}", multisig.key());
    msg!("Số chữ ký hiện tại: {}/{}", proposal.signatures_count, proposal.required_signatures);
    
    // Chỉ xử lý đề xuất chuyển token trong hàm này
    require!(
        proposal.action == "transfer_token",
        WalletError::UnsupportedAction
    );
    
    let token_mint = proposal.params.token_mint.ok_or(WalletError::InvalidOperation)?;
    let token_amount = proposal.params.token_amount.ok_or(WalletError::InvalidOperation)?;
    
    let from_token_account = &ctx.accounts.from_token_account;
    let to_token_account = &ctx.accounts.to_token_account;
    
    require!(
        from_token_account.mint == token_mint,
        WalletError::InvalidOperation
    );
    
    require!(
        to_token_account.mint == token_mint,
        WalletError::InvalidOperation
    );
    
    let credential_id_bytes = process_credential_id_seed(&multisig_credential_id);
    let seeds = &[
        b"multisig".as_ref(),
        &credential_id_bytes,
        &[multisig_bump]
    ];
    let signer_seeds = &[&seeds[..]];
    
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplTransfer {
                from: from_token_account.to_account_info(),
                to: to_token_account.to_account_info(),
                authority: multisig.to_account_info(),
            },
            signer_seeds,
        ),
        token_amount
    )?;
    
    msg!("Đã chuyển {} token ({}) từ multisig đến {}", 
        token_amount, 
        token_mint.to_string(), 
        ctx.accounts.destination.key());
    
    // Cập nhật trạng thái đề xuất
    proposal.status = ProposalStatus::Executed;
    proposal.executed_at = Some(clock.unix_timestamp);
    
    multisig.transaction_nonce += 1;
    multisig.last_transaction_timestamp = clock.unix_timestamp;
    
    msg!("Đã thực thi đề xuất {} thành công", proposal_id);
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(proposal_id: u64, guardian_id: u64, timestamp: i64)]
pub struct RejectProposal<'info> {
    #[account(mut)]
    pub multisig: Account<'info, MultiSigWallet>,
    
    #[account(
        mut,
        seeds = [
            b"proposal".as_ref(), 
            multisig.key().as_ref(), 
            &proposal_id.to_le_bytes()
        ],
        bump = proposal.bump,
        constraint = proposal.status == ProposalStatus::Pending @ WalletError::InvalidOperation,
        constraint = *multisig.to_account_info().key == proposal.multisig @ WalletError::MultisigMismatch
    )]
    pub proposal: Account<'info, TransactionProposal>,
    
    #[account(
        seeds = [b"guardian".as_ref(), multisig.key().as_ref(), &guardian_id.to_le_bytes()],
        bump = guardian.bump,
        constraint = guardian.is_active @ WalletError::InactiveGuardian
    )]
    pub guardian: Account<'info, Guardian>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,
    
    pub clock: Sysvar<'info, Clock>,
}

pub fn reject_proposal(
    ctx: Context<RejectProposal>,
    proposal_id: u64,
    guardian_id: u64,
    timestamp: i64,
    message: Vec<u8>
) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;
    let guardian = &ctx.accounts.guardian;
    let clock = &ctx.accounts.clock;
    
    msg!("Bắt đầu từ chối đề xuất với ID: {}", proposal_id);
    msg!("Địa chỉ multisig: {}", multisig.key());
    msg!("Guardian ID: {}", guardian_id);
    msg!("Timestamp: {}", timestamp);
    
    require!(
        *multisig.to_account_info().owner == crate::ID,
        WalletError::InvalidOwner
    );
    
    require!(
        timestamp <= clock.unix_timestamp + 60, 
        WalletError::FutureTimestamp
    );
    
    require!(
        timestamp >= clock.unix_timestamp - 300,
        WalletError::ExpiredTimestamp
    );
    
    if let Some(webauthn_pubkey) = guardian.webauthn_pubkey {
        msg!("Guardian có WebAuthn public key: {}", to_hex(&webauthn_pubkey));
        
        let instruction_sysvar = &ctx.accounts.instruction_sysvar;
        require!(
            !instruction_sysvar.data_is_empty(),
            WalletError::InstructionMissing
        );
        
        let secp_ix = load_instruction_at_checked(0, instruction_sysvar)?;
        
        let secp256r1_verify_id = Pubkey::from_str("Secp256r1SigVerify1111111111111111111111111").unwrap();
        require!(
            secp_ix.program_id == secp256r1_verify_id,
            WalletError::InvalidSignatureVerification
        );
        
        let pk_in_ix = extract_public_key_from_secp_instruction(&secp_ix.data)?;
        
        msg!("Public key từ instruction: {}", to_hex(&pk_in_ix));
        
        require!(
            pk_in_ix == webauthn_pubkey,
            WalletError::PublicKeyMismatch
        );
        
        let pubkey_hash = hash(&webauthn_pubkey).to_bytes();
        let pubkey_hash_hex = to_hex(&pubkey_hash[0..6]);
        
        let expected_message = format!(
            "reject:proposal_{},guardian_{},timestamp:{},pubkey:{}",
            proposal_id,
            guardian_id,
            timestamp,
            pubkey_hash_hex
        );
        
        msg!("Expected message: {}", expected_message);
        msg!("Received message length: {}", message.len());
        msg!("Received message: {}", String::from_utf8_lossy(&message));
        
        if expected_message.as_bytes().len() == message.len() {
            for (i, (exp, rec)) in expected_message.as_bytes().iter().zip(message.iter()).enumerate() {
                if exp != rec {
                    msg!("Khác biệt tại vị trí [{}]: Expected {} ({}), Received {} ({})", 
                        i, exp, char::from(*exp), rec, char::from(*rec));
                }
            }
        }
        
        require!(
            message == expected_message.as_bytes(),
            WalletError::MessageMismatch
        );
    }
    
    proposal.status = ProposalStatus::Rejected;
    
    msg!("Guardian {} đã từ chối đề xuất {}", guardian_id, proposal_id);
    
    Ok(())
} 