/**
 * fee.ts
 *
 * Fee calculation utilities for Stellar transactions.
 * Handles both Soroban and regular transaction fee calculations.
 */

import { Transaction, xdr } from '@stellar/stellar-sdk';
import { FEE } from './constants';

export function calculateFee(transaction: Transaction): bigint {
  // Extract resource fee from transaction if it has Soroban data
  let resourceFee = 0n;

  const envelope = transaction.toEnvelope();
  if (envelope.switch() === xdr.EnvelopeType.envelopeTypeTx()) {
    const sorobanData = envelope.v1().tx().ext().sorobanData();
    if (sorobanData) {
      resourceFee = sorobanData.resourceFee().toBigInt();
    }
  }

  // Random base fee between min and max
  const baseFee = getRandomNumber(FEE.MIN_BASE_FEE, FEE.MAX_BASE_FEE);

  // Calculate total fee
  if (resourceFee > 0) {
    return BigInt(baseFee) + resourceFee;
  } else {
    // For non-Soroban transactions
    return BigInt(baseFee) + BigInt(FEE.RESOURCE_FEE_OFFSET);
  }
}

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
