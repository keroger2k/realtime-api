import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configDir = join(__dirname, '..', 'config');

// Cache for loaded data (reload on restart)
let businessKnowledgeCache = null;
let contactsCache = null;
let systemPromptCache = null;
let transferNumbersCache = null;

/**
 * Load business knowledge from file
 * Easy to swap for: return await db.query('SELECT content FROM knowledge WHERE active = true')
 */
export async function getBusinessKnowledge() {
  if (businessKnowledgeCache) {
    return businessKnowledgeCache;
  }

  try {
    const content = await readFile(join(configDir, 'business-info.md'), 'utf-8');
    businessKnowledgeCache = content;
    return content;
  } catch (error) {
    console.error('[dataAccess] Failed to load business knowledge:', error.message);
    return '';
  }
}

/**
 * Load system prompt template from file
 * Easy to swap for: return await db.query('SELECT prompt FROM prompts WHERE name = $1', ['system'])
 */
export async function getSystemPrompt() {
  if (systemPromptCache) {
    return systemPromptCache;
  }

  try {
    const content = await readFile(join(configDir, 'system-prompt.txt'), 'utf-8');
    systemPromptCache = content;
    return content;
  } catch (error) {
    console.error('[dataAccess] Failed to load system prompt:', error.message);
    return '';
  }
}

/**
 * Load all contacts from file
 * Easy to swap for: return await db.query('SELECT * FROM contacts')
 */
async function loadContacts() {
  if (contactsCache) {
    return contactsCache;
  }

  try {
    const content = await readFile(join(configDir, 'contacts.json'), 'utf-8');
    contactsCache = JSON.parse(content);
    return contactsCache;
  } catch (error) {
    console.error('[dataAccess] Failed to load contacts:', error.message);
    return {};
  }
}

/**
 * Get contact information by phone number
 * Easy to swap for: return await db.query('SELECT * FROM contacts WHERE phone = $1', [phoneNumber])
 */
export async function getContact(phoneNumber) {
  const contacts = await loadContacts();
  return contacts[phoneNumber] || null;
}

/**
 * Load all transfer numbers from file
 * Easy to swap for: return await db.query('SELECT * FROM transfer_numbers')
 */
async function loadTransferNumbers() {
  if (transferNumbersCache) {
    return transferNumbersCache;
  }

  try {
    const content = await readFile(join(configDir, 'transfer-numbers.json'), 'utf-8');
    transferNumbersCache = JSON.parse(content);
    return transferNumbersCache;
  } catch (error) {
    console.error('[dataAccess] Failed to load transfer numbers:', error.message);
    return {};
  }
}

/**
 * Get transfer number by key (e.g., "sales", "support", "John")
 * Easy to swap for: return await db.query('SELECT * FROM transfer_numbers WHERE key = $1', [key])
 */
export async function getTransferNumber(key) {
  const numbers = await loadTransferNumbers();
  return numbers[key] || null;
}

/**
 * Get all transfer numbers
 */
export async function getAllTransferNumbers() {
  return await loadTransferNumbers();
}

/**
 * Reload all cached data (useful for updates without restart)
 */
export function clearCache() {
  businessKnowledgeCache = null;
  contactsCache = null;
  systemPromptCache = null;
  transferNumbersCache = null;
  console.log('[dataAccess] Cache cleared');
}
