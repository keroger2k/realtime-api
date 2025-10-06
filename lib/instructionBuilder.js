import { getBusinessKnowledge, getSystemPrompt, getContact, getAllTransferNumbers } from './dataAccess.js';

/**
 * Build dynamic system instructions for a call
 * Combines: system prompt + business knowledge + caller personalization + transfer options
 */
export async function buildInstructions(callerPhone) {
  const [systemPrompt, businessKnowledge, contact, transferNumbers] = await Promise.all([
    getSystemPrompt(),
    getBusinessKnowledge(),
    getContact(callerPhone),
    getAllTransferNumbers()
  ]);

  let instructions = systemPrompt;

  // Add business knowledge
  if (businessKnowledge) {
    instructions += '\n\n## Business Knowledge\n' + businessKnowledge;
  }

  // Add call transfer capabilities
  if (Object.keys(transferNumbers).length > 0) {
    instructions += '\n\n## Call Transfer Capability\n';
    instructions += 'You can transfer calls to team members. Available transfer options:\n\n';

    for (const [key, info] of Object.entries(transferNumbers)) {
      instructions += `- **${key}**: ${info.name} (${info.description})\n`;
    }

    instructions += '\n### How to Transfer\n';
    instructions += 'When a caller asks to speak with someone or needs to be transferred:\n';
    instructions += '1. Confirm who they want to speak with\n';
    instructions += '2. Say: "Let me transfer you to [name]. Please hold for a moment."\n';
    instructions += '3. Use the transfer function with the appropriate key (e.g., "sales", "John", "support")\n';
    instructions += '\nIMPORTANT: Only transfer when the caller explicitly requests it or when you cannot help them.\n';
  }

  // Add caller personalization
  if (contact) {
    instructions += '\n\n## Caller Information\n';
    instructions += `- Name: ${contact.name}\n`;
    if (contact.company) {
      instructions += `- Company: ${contact.company}\n`;
    }
    if (contact.role) {
      instructions += `- Role: ${contact.role}\n`;
    }
    if (contact.vip) {
      instructions += `- VIP Client: Yes - provide premium service\n`;
    }
    if (contact.notes) {
      instructions += `- Notes: ${contact.notes}\n`;
    }
  }

  return instructions;
}

/**
 * Build personalized greeting message for a call
 */
export async function buildGreeting(callerPhone) {
  const contact = await getContact(callerPhone);

  // Use custom greeting if available
  if (contact?.preferredGreeting) {
    return contact.preferredGreeting;
  }

  // Personalized greeting with name
  if (contact?.name) {
    return `Hi ${contact.name}! Thank you for calling Apex AI Solutions. How can I help you today?`;
  }

  // Default greeting for unknown callers
  return "Thank you for calling Apex AI Solutions! How can I help you today?";
}
