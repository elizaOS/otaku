/**
 * Content quality detection utilities
 * Filters out spam, copy-pasta, and low-quality messages from earning points
 */

import { logger } from '@elizaos/core';

export interface ContentQualityResult {
  isValid: boolean;
  reason?: string;
  score: number; // 0-100, higher is better quality
}

/**
 * Configuration for content quality thresholds
 */
export const CONTENT_QUALITY_CONFIG = {
  // Character repetition
  MAX_CONSECUTIVE_SAME_CHAR: 4,           // e.g., "aaaaa" fails
  MAX_CHAR_REPETITION_RATIO: 0.5,         // If >50% of message is same char, fail
  
  // Word repetition  
  MAX_WORD_REPETITION_RATIO: 0.6,         // If >60% of words are repeated, fail
  MIN_UNIQUE_WORD_RATIO: 0.3,             // Need at least 30% unique words
  
  // Entropy / content diversity
  MIN_SHANNON_ENTROPY: 2.0,               // Minimum entropy for valid message
  
  // Emoji spam
  MAX_EMOJI_RATIO: 0.5,                   // Emojis can't be >50% of content
  
  // URL spam
  MAX_URL_RATIO: 0.7,                     // URLs can't be >70% of content
  
  // Keyboard mash patterns
  KEYBOARD_MASH_THRESHOLD: 0.4,           // If >40% matches keyboard patterns, fail
  
  // ASCII art / special char spam
  MAX_SPECIAL_CHAR_RATIO: 0.4,            // Special chars can't be >40% of content
};

// Common keyboard mash patterns (QWERTY layout)
const KEYBOARD_MASH_PATTERNS = [
  /qwert/gi,
  /asdf/gi,
  /zxcv/gi,
  /qazwsx/gi,
  /yuiop/gi,
  /ghjkl/gi,
  /bnm/gi,
  /edcrfv/gi,
  /tgbyhn/gi,
  /ujmik/gi,
  /[1234567890]{5,}/g,                    // Number sequences
  /abcdef/gi,                             // Alphabet sequences
  /xyz/gi,
];

// Regex for detecting repeated characters
const CONSECUTIVE_CHAR_REGEX = /(.)\1{4,}/g;

// Regex for emoji detection (covers most emoji ranges)
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

// Special characters (excluding common punctuation)
const SPECIAL_CHAR_REGEX = /[^\w\s.,!?'"()-]/g;

// Common spam/meaningless phrases
const SPAM_PHRASES = [
  /^(hey|hi|hello|sup|yo)+$/i,
  /^(ok|okay|k|kk|kkk)+$/i,
  /^(yes|yeah|yep|yup|no|nope)+$/i,
  /^(lol|lmao|rofl|haha|hehe)+$/i,
  /^(nice|cool|great|good|bad|wow)+$/i,
  /^(gm|gn|gg|ty|thx|thanks)+$/i,
  /^[\s\S]*\btest\b[\s\S]*$/i,
  /^(please|pls|plz)\s+(help|send|give)/i,
];

/**
 * Calculate Shannon entropy of a string
 * Higher entropy = more randomness/diversity
 */
function calculateEntropy(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  
  const freq: Record<string, number> = {};
  for (const char of text.toLowerCase()) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  let entropy = 0;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

/**
 * Check for consecutive repeated characters
 */
function checkRepeatedChars(text: string): { valid: boolean; ratio: number } {
  const matches = text.match(CONSECUTIVE_CHAR_REGEX) || [];
  const repeatedLength = matches.reduce((sum, m) => sum + m.length, 0);
  const ratio = repeatedLength / text.length;
  
  // Also check if single char dominates
  const charCounts: Record<string, number> = {};
  for (const char of text.toLowerCase()) {
    if (char.trim()) {
      charCounts[char] = (charCounts[char] || 0) + 1;
    }
  }
  const maxCharCount = Math.max(...Object.values(charCounts), 0);
  const dominantRatio = maxCharCount / text.replace(/\s/g, '').length;
  
  return {
    valid: ratio < CONTENT_QUALITY_CONFIG.MAX_CHAR_REPETITION_RATIO && 
           dominantRatio < CONTENT_QUALITY_CONFIG.MAX_CHAR_REPETITION_RATIO,
    ratio: Math.max(ratio, dominantRatio),
  };
}

/**
 * Check for repeated words (copy-pasta indicator)
 */
function checkRepeatedWords(text: string): { valid: boolean; uniqueRatio: number } {
  const words = text.toLowerCase().match(/\b[a-z]+\b/gi) || [];
  if (words.length < 3) return { valid: true, uniqueRatio: 1 };
  
  const uniqueWords = new Set(words);
  const uniqueRatio = uniqueWords.size / words.length;
  
  // Count word repetitions
  const wordCounts: Record<string, number> = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }
  
  // Check if any word repeats too much
  const maxRepetition = Math.max(...Object.values(wordCounts));
  const repetitionRatio = maxRepetition / words.length;
  
  return {
    valid: uniqueRatio >= CONTENT_QUALITY_CONFIG.MIN_UNIQUE_WORD_RATIO &&
           repetitionRatio < CONTENT_QUALITY_CONFIG.MAX_WORD_REPETITION_RATIO,
    uniqueRatio,
  };
}

/**
 * Check for keyboard mash patterns
 */
function checkKeyboardMash(text: string): { valid: boolean; matchRatio: number } {
  let matchedLength = 0;
  const cleanText = text.replace(/\s/g, '').toLowerCase();
  
  for (const pattern of KEYBOARD_MASH_PATTERNS) {
    const matches = cleanText.match(pattern) || [];
    matchedLength += matches.reduce((sum, m) => sum + m.length, 0);
  }
  
  const ratio = cleanText.length > 0 ? matchedLength / cleanText.length : 0;
  return {
    valid: ratio < CONTENT_QUALITY_CONFIG.KEYBOARD_MASH_THRESHOLD,
    matchRatio: ratio,
  };
}

/**
 * Check emoji spam
 */
function checkEmojiSpam(text: string): { valid: boolean; ratio: number } {
  const emojis = text.match(EMOJI_REGEX) || [];
  const emojiLength = emojis.length * 2; // Each emoji counts as ~2 chars
  const ratio = emojiLength / Math.max(text.length, 1);
  
  return {
    valid: ratio <= CONTENT_QUALITY_CONFIG.MAX_EMOJI_RATIO,
    ratio,
  };
}

/**
 * Check URL spam
 */
function checkUrlSpam(text: string): { valid: boolean; ratio: number } {
  const urls = text.match(URL_REGEX) || [];
  const urlLength = urls.reduce((sum, url) => sum + url.length, 0);
  const ratio = urlLength / Math.max(text.length, 1);
  
  return {
    valid: ratio <= CONTENT_QUALITY_CONFIG.MAX_URL_RATIO,
    ratio,
  };
}

/**
 * Check special character spam (ASCII art, etc.)
 */
function checkSpecialCharSpam(text: string): { valid: boolean; ratio: number } {
  const specialChars = text.match(SPECIAL_CHAR_REGEX) || [];
  const ratio = specialChars.length / Math.max(text.length, 1);
  
  return {
    valid: ratio <= CONTENT_QUALITY_CONFIG.MAX_SPECIAL_CHAR_RATIO,
    ratio,
  };
}

/**
 * Check for common spam phrases
 */
function checkSpamPhrases(text: string): boolean {
  const trimmed = text.trim();
  for (const pattern of SPAM_PHRASES) {
    if (pattern.test(trimmed)) {
      return false; // Is spam
    }
  }
  return true; // Not spam
}

/**
 * Comprehensive content quality check
 * Returns whether the message should earn points
 */
export function checkContentQuality(text: string): ContentQualityResult {
  if (!text || typeof text !== 'string') {
    return { isValid: false, reason: 'Empty or invalid content', score: 0 };
  }
  
  const trimmedText = text.trim();
  
  // Skip very short messages (handled by MIN_CHAT_LENGTH in caller)
  if (trimmedText.length < 10) {
    return { isValid: false, reason: 'Too short', score: 0 };
  }
  
  let score = 100;
  const reasons: string[] = [];
  
  // 1. Check repeated characters
  const charCheck = checkRepeatedChars(trimmedText);
  if (!charCheck.valid) {
    score -= 40;
    reasons.push('repeated_chars');
  } else {
    score -= charCheck.ratio * 20;
  }
  
  // 2. Check repeated words
  const wordCheck = checkRepeatedWords(trimmedText);
  if (!wordCheck.valid) {
    score -= 35;
    reasons.push('repeated_words');
  } else {
    score -= (1 - wordCheck.uniqueRatio) * 15;
  }
  
  // 3. Check keyboard mash
  const mashCheck = checkKeyboardMash(trimmedText);
  if (!mashCheck.valid) {
    score -= 50;
    reasons.push('keyboard_mash');
  } else {
    score -= mashCheck.matchRatio * 25;
  }
  
  // 4. Check entropy
  const entropy = calculateEntropy(trimmedText);
  if (entropy < CONTENT_QUALITY_CONFIG.MIN_SHANNON_ENTROPY) {
    score -= 30;
    reasons.push('low_entropy');
  }
  
  // 5. Check emoji spam
  const emojiCheck = checkEmojiSpam(trimmedText);
  if (!emojiCheck.valid) {
    score -= 25;
    reasons.push('emoji_spam');
  }
  
  // 6. Check URL spam
  const urlCheck = checkUrlSpam(trimmedText);
  if (!urlCheck.valid) {
    score -= 30;
    reasons.push('url_spam');
  }
  
  // 7. Check special char spam
  const specialCheck = checkSpecialCharSpam(trimmedText);
  if (!specialCheck.valid) {
    score -= 25;
    reasons.push('special_char_spam');
  }
  
  // 8. Check common spam phrases
  if (!checkSpamPhrases(trimmedText)) {
    score -= 35;
    reasons.push('spam_phrase');
  }
  
  // Normalize score
  score = Math.max(0, Math.min(100, score));
  
  // Threshold for valid content
  const isValid = score >= 50;
  
  if (!isValid) {
    logger.debug(
      { text: trimmedText.substring(0, 50), score, reasons },
      '[ContentQuality] Message failed quality check'
    );
  }
  
  return {
    isValid,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
    score,
  };
}

/**
 * Quick check for obvious spam without full analysis
 * More efficient for high-volume scenarios
 */
export function quickSpamCheck(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  const trimmed = text.trim();
  
  // Check consecutive repeats (e.g., "aaaaaaa")
  if (CONSECUTIVE_CHAR_REGEX.test(trimmed)) return false;
  
  // Check keyboard mash (quick version)
  for (const pattern of KEYBOARD_MASH_PATTERNS.slice(0, 5)) {
    if (pattern.test(trimmed)) return false;
  }
  
  // Check spam phrases
  if (!checkSpamPhrases(trimmed)) return false;
  
  return true;
}

