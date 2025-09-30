/**
 * validation.ts
 *
 * Request validation and parsing for the Launchtube plugin.
 * Ensures proper request structure and parameter compatibility.
 */

import { pluginError } from '@openzeppelin/relayer-sdk';
import { LaunchtubeRequest } from './types';

export function validateAndParseRequest(params: any): LaunchtubeRequest {
  // First, validate the basic parameter structure
  if (params.sim === false && !params.xdr) {
    throw pluginError('Cannot pass `sim = false` without `xdr`', {
      code: 'INVALID_PARAMS',
      status: 400,
      details: { sim: params.sim ?? undefined, xdrProvided: Boolean(params?.xdr) },
    });
  }

  if (!params.xdr && !params.func && !params.auth) {
    throw pluginError('Must pass either `xdr` or `func` and `auth`', {
      code: 'INVALID_PARAMS',
      status: 400,
    });
  }

  if (params.xdr && (params.func || params.auth)) {
    throw pluginError('`func` and `auth` must be omitted when passing `xdr`', {
      code: 'INVALID_PARAMS',
      status: 400,
    });
  }

  if (!params.xdr && !(params.func && params.auth)) {
    throw pluginError('`func` and `auth` are both required when omitting `xdr`', {
      code: 'INVALID_PARAMS',
      status: 400,
    });
  }

  // Determine request type and return structured request
  const sim = params.sim !== false; // Default to true if not specified

  if (params.xdr) {
    return {
      type: 'xdr',
      xdr: params.xdr,
      sim,
    };
  } else {
    return {
      type: 'func-auth',
      func: params.func,
      auth: params.auth,
      sim,
    };
  }
}
