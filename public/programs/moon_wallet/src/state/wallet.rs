use anchor_lang::prelude::*;


#[account]
pub struct MultiSigWallet {
    pub threshold: u8,               
    pub guardian_count: u8,          
    pub recovery_nonce: u64,         
    pub bump: u8,                    
    pub transaction_nonce: u64,      
    pub last_transaction_timestamp: i64, 
    pub owner: Pubkey,               
    pub credential_id: String,       
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ActionParams {
    pub amount: Option<u64>,        
    pub destination: Option<Pubkey>, 
    pub token_mint: Option<Pubkey>,
    pub token_amount: Option<u64>,   
}