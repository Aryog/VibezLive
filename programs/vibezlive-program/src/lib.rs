use anchor_lang::prelude::*;

declare_id!("2E1RJY5igTkznpixkeWxkjfnnRSuLuThKPL8914nE7wq");

#[program]
pub mod vibezlive_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
