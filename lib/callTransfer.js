import fetch from 'node-fetch';
import { getTransferNumber } from './dataAccess.js';

/**
 * Transfer a call to another number using the OpenAI Realtime Refer API.
 * @param {string} callId - The OpenAI call_id to transfer
 * @param {string} transferKey - The key from transfer-numbers.json (e.g., "sales", "John")
 * @returns {Promise<{success: boolean, message: string, transferredTo?: string}>}
 */
export async function transferCall(callId, transferKey) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'transfer',
    callId,
    message: 'Transfer initiated',
    transferKey
  }));

  const transferInfo = await getTransferNumber(transferKey);
  if (!transferInfo) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'transfer',
      callId,
      message: 'Transfer key not found',
      transferKey,
      error: 'Invalid destination key'
    }));
    return {
      success: false,
      message: `Transfer destination "${transferKey}" not found`
    };
  }

  const targetNumber = transferInfo.number;
  // Use Twilio SIP URI format for proper call routing
  const targetUri = `sip:${targetNumber}@apexaisolutions.pstn.ashburn.twilio.com`;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'transfer',
    callId,
    message: 'Executing transfer',
    transferKey,
    targetName: transferInfo.name,
    targetNumber,
    targetUri
  }));

  try {
    const response = await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/refer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_uri: targetUri })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const requestId = response.headers.get('x-request-id');
      const message = `Refer failed (${response.status})${requestId ? ` [request-id=${requestId}]` : ''}: ${errorText}`;

      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        category: 'transfer',
        callId,
        message: 'Transfer API call failed',
        transferKey,
        targetUri,
        targetName: transferInfo.name,
        httpStatus: response.status,
        requestId,
        errorText,
        error: message
      }));

      throw new Error(message);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'transfer',
      callId,
      message: 'Transfer successful',
      transferKey,
      targetName: transferInfo.name,
      targetUri
    }));

    return {
      success: true,
      message: `Call transferred to ${transferInfo.name}`,
      transferredTo: transferInfo.name
    };
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'transfer',
      callId,
      message: 'Transfer exception',
      transferKey,
      targetUri,
      targetName: transferInfo.name,
      error: error.message,
      stack: error.stack
    }));

    return {
      success: false,
      message: `Transfer error: ${error.message}`
    };
  }
}

/**
 * Create the transfer function tool definition for the Realtime API
 */
export function getTransferTool() {
  return {
    type: "function",
    name: "transfer_call",
    description: "Transfer the current call to another team member or department. Use this when the caller asks to speak with someone specific or needs specialized help.",
    parameters: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          enum: ["sales", "support", "John", "cohen", "main"],
          description: "The person or department to transfer to. Options: sales (Sales Team), support (Technical Support), John (John Rogers - Founder), cohen (Cohen Rogers - General Inquiries), main (Main Office)"
        }
      },
      required: ["destination"]
    }
  };
}
