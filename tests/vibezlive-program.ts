import * as anchor from "@coral-xyz/anchor";
import { Program, Idl, AnchorProvider } from "@coral-xyz/anchor";
import { VibezliveProgram } from "../target/types/vibezlive_program";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount } from "@solana/spl-token";
import { assert } from "chai";

// Import the IDL
import { IDL } from "../target/types/vibezlive_program";

describe("vibezlive-program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Switch back to direct program initialization with explicit program ID
  const programId = new PublicKey("2E1RJY5igTkznpixkeWxkjfnnRSuLuThKPL8914nE7wq");
  const program = new Program(IDL as any, provider, programId as any) as any;
  
  // Test accounts
  let platformState: PublicKey;
  let platformAuthority: anchor.web3.Keypair;
  let creator: anchor.web3.Keypair;
  let donor: anchor.web3.Keypair;
  let viewer: anchor.web3.Keypair;
  
  // Token accounts
  let tokenMint: PublicKey; 
  let creatorTokenAccount: PublicKey;
  let donorTokenAccount: PublicKey;
  let viewerTokenAccount: PublicKey;
  
  // Stream related
  let stream: PublicKey;
  let escrowAccount: PublicKey;
  let streamBump: number;
  let escrowBump: number;

  before(async () => {
    // Generate necessary keypairs
    platformAuthority = anchor.web3.Keypair.generate();
    creator = anchor.web3.Keypair.generate();
    donor = anchor.web3.Keypair.generate();
    viewer = anchor.web3.Keypair.generate();

    // Airdrop SOL to accounts that need it
    const signature = await provider.connection.requestAirdrop(
      platformAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      platformAuthority,
      platformAuthority.publicKey,
      null,
      6
    );

    // Create token accounts
    creatorTokenAccount = await createAccount(
      provider.connection,
      creator,
      tokenMint,
      creator.publicKey
    );

    donorTokenAccount = await createAccount(
      provider.connection,
      donor,
      tokenMint,
      donor.publicKey
    );

    viewerTokenAccount = await createAccount(
      provider.connection,
      viewer,
      tokenMint,
      viewer.publicKey
    );

    // Find PDA for platform state
    [platformState] = await PublicKey.findProgramAddress(
      [Buffer.from("platform_state")],
      program.programId
    );
  });

  it("Initialize Platform", async () => {
    const platformFee = 5; // 5%

    await program.methods
      .initializePlatform(platformFee)
      .accounts({
        authority: platformAuthority.publicKey,
        platformState,
        systemProgram: SystemProgram.programId,
      })
      .signers([platformAuthority])
      .rpc();

    const platformStateAccount = await program.account.platformState.fetch(
      platformState
    );

    assert.equal(platformStateAccount.authority.toBase58(), platformAuthority.publicKey.toBase58());
    assert.equal(platformStateAccount.platformFee, platformFee);
    assert.equal(platformStateAccount.streamCount, 0);
  });

  it("Start Stream", async () => {
    const streamId = "test-stream-1";
    const creatorPercentage = 70; // 70%
    const minWatchPercentage = 50; // 50%
    const minStreamDuration = 300; // 5 minutes

    // Find PDA for stream
    [stream, streamBump] = await PublicKey.findProgramAddress(
      [Buffer.from("stream"), Buffer.from(streamId)],
      program.programId
    );

    // Find PDA for escrow
    [escrowAccount, escrowBump] = await PublicKey.findProgramAddress(
      [Buffer.from("escrow"), stream.toBuffer()],
      program.programId
    );

    await program.methods
      .startStream(
        streamId,
        creatorPercentage,
        minWatchPercentage,
        new anchor.BN(minStreamDuration),
        {
          streamBump,
          escrowBump,
        }
      )
      .accounts({
        creator: creator.publicKey,
        platformState,
        authority: platformAuthority.publicKey,
        stream,
        escrowAccount,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    const streamAccount = await program.account.stream.fetch(stream);
    assert.equal(streamAccount.id, streamId);
    assert.equal(streamAccount.creator.toBase58(), creator.publicKey.toBase58());
    assert.equal(streamAccount.isActive, true);
    assert.equal(streamAccount.creatorPercentage, creatorPercentage);
    assert.equal(streamAccount.minWatchPercentage, minWatchPercentage);
    assert.equal(streamAccount.minStreamDuration.toNumber(), minStreamDuration);
  });

  // Add more tests for other functionalities like:
  // - Donations
  // - Ending streams
  // - Claiming rewards
  // - Auto settling streams
  // - Disputes
});
