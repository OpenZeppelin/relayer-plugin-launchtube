/**
 * simulation.ts
 *
 * Handles Soroban transaction simulation and building.
 * Manages transaction validation and resource fee calculations.
 */

import { Transaction, TransactionBuilder, Operation, Account, SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { pluginError, Relayer, SignTransactionResponseStellar } from '@openzeppelin/relayer-sdk';
import { ExtractedData, SequenceAccount, RpcClient } from './types';

export async function simulateAndBuild(
  extracted: ExtractedData,
  sequence: SequenceAccount,
  sequenceRelayer: Relayer,
  rpc: RpcClient,
  networkPassphrase: string,
): Promise<Transaction> {
  const now = Math.floor(Date.now() / 1000);

  // Build transaction for simulation using sequence account
  const transaction = new TransactionBuilder(new Account(sequence.address, sequence.sequence), {
    fee: '100', // Will be updated after simulation
    networkPassphrase: networkPassphrase,
    ledgerbounds: extracted.inputTx?.ledgerBounds,
    timebounds: extracted.inputTx?.timeBounds || {
      minTime: 0,
      maxTime: now + 30,
    },
    memo: extracted.inputTx?.memo,
    minAccountSequence: extracted.inputTx?.minAccountSequence,
    minAccountSequenceAge: extracted.inputTx?.minAccountSequenceAge,
    minAccountSequenceLedgerGap: extracted.inputTx?.minAccountSequenceLedgerGap,
    extraSigners: extracted.inputTx?.extraSigners,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: extracted.func,
        auth: extracted.auth,
        source: (extracted.inputTx?.operations[0] as any)?.source,
      }),
    )
    .build();

  // Simulate the transaction
  const simResult = await rpc.simulateTransaction(transaction);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw pluginError('Simulation failed', {
      code: 'SIMULATION_FAILED',
      status: 400,
      details: { error: (simResult as any).error },
    });
  }

  if (SorobanRpc.Api.isSimulationRestore(simResult)) {
    throw pluginError('Restore flow not yet supported', { code: 'RESTORE_UNSUPPORTED', status: 400 });
  }

  const successResult = simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse;

  // Verify auth matches what we provided
  validateSimulatedAuth(extracted.auth, successResult.result?.auth);

  // Get transaction data and build final transaction
  const transactionData = successResult.transactionData;
  if (!transactionData) {
    throw pluginError('No transaction data from simulation', {
      code: 'NO_SIMULATION_DATA',
      status: 400,
    });
  }

  const sorobanData = transactionData.build();
  const resourceFee = sorobanData.resourceFee().toBigInt();

  // Clone transaction with simulation results
  const finalTransaction = TransactionBuilder.cloneFrom(transaction, {
    fee: resourceFee.toString(),
    sorobanData,
  }).build();

  // Sign with sequence account
  const signResult = (await sequenceRelayer.signTransaction({
    unsigned_xdr: finalTransaction.toXDR(),
  })) as SignTransactionResponseStellar;

  return new Transaction(signResult.signedXdr, networkPassphrase);
}

export function validateExistingTransaction(tx: Transaction): Transaction {
  // Validate transaction constraints for non-simulated path
  const envelope = tx.toEnvelope();
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) {
    throw pluginError('Invalid transaction envelope type', {
      code: 'INVALID_OPERATION',
      status: 400,
    });
  }

  const sorobanData = envelope.v1().tx().ext().sorobanData();
  if (sorobanData) {
    const resourceFee = sorobanData.resourceFee().toBigInt();

    if (BigInt(tx.fee) > resourceFee + 201n) {
      throw pluginError('Transaction fee must be equal to the resource fee', {
        code: 'FEE_MISMATCH',
        status: 400,
        details: { fee: tx.fee, resourceFee: resourceFee.toString() },
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (tx.timeBounds?.maxTime && Number(tx.timeBounds.maxTime) - now > 30) {
    throw pluginError('Transaction `timeBounds.maxTime` too far into the future. Must be no greater than 30 seconds', {
      code: 'TIMEBOUNDS_TOO_FAR',
      status: 400,
    });
  }

  return tx;
}

function validateSimulatedAuth(
  providedAuth: xdr.SorobanAuthorizationEntry[] | undefined,
  simulatedAuth: xdr.SorobanAuthorizationEntry[] | undefined,
): void {
  if (providedAuth && providedAuth.length > 0) {
    if (!simulatedAuth || simulatedAuth.length === 0) {
      throw pluginError('Auth invalid - simulation returned no auth', { code: 'AUTH_INVALID', status: 400 });
    }

    // Check arrays have same auth entries (order doesn't matter)
    const providedAuthXdr = providedAuth.map((a) => a.toXDR('base64'));
    const simulatedAuthXdr = simulatedAuth.map((a) => a.toXDR('base64'));

    const authMatches =
      providedAuthXdr.length === simulatedAuthXdr.length &&
      providedAuthXdr.every((a) => simulatedAuthXdr.includes(a)) &&
      simulatedAuthXdr.every((a) => providedAuthXdr.includes(a));

    if (!authMatches) {
      throw pluginError('Auth invalid - simulation returned different auth', { code: 'AUTH_INVALID', status: 400 });
    }
  }
}
