import disposableDomains from 'disposable-email-domains';

const disposableSet = new Set(disposableDomains as string[]);

export function isValidEmail(email: string): { valid: boolean; reason?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'Email is required.' };
  }

  const trimmed = email.trim().toLowerCase();
  
  // Basic regex check
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, reason: 'Please enter a valid email address.' };
  }

  const domain = trimmed.split('@')[1];
  if (disposableSet.has(domain)) {
    return { valid: false, reason: 'Disposable or temporary email addresses are not allowed.' };
  }

  return { valid: true };
}
