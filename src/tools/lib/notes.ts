/*
 * Shared pieces of the tools' first-hand notes (see ToolNotes): the machine the "Typical results" were measured on,
 * and platform file caps quoted from each platform's own help pages. Sizes in results use the same units as the tools
 * (1 KB = 1,024 bytes); the platform caps are as each platform states them.
 */

/** every result in the first notes batch was measured in one sitting, on this machine */
export const MEASURED = { date: '2026-10-27', device: 'Chrome 155 on a Windows 11 desktop (Core i7-12700F, GeForce RTX 3070 Ti)' };

export const LIMITS = {
  gmail: { where: 'Gmail', limit: '25 MB of attachments per email; bigger files are sent as a Google Drive link instead', source: 'https://support.google.com/mail/answer/6584' },
  outlook: { where: 'Outlook.com (and Gmail accounts used in Outlook)', limit: '20 MB per email, message and attachments together', source: 'https://support.microsoft.com/en-us/office/send-large-files-with-outlook-8c698842-b462-4a4c-8d53-5c5dd04f77ef' },
  exchange: { where: 'Work email on Microsoft Exchange', limit: '10 MB per email by default (the admin can change it)', source: 'https://support.microsoft.com/en-us/office/send-large-files-with-outlook-8c698842-b462-4a4c-8d53-5c5dd04f77ef' },
  yahoo: { where: 'Yahoo Mail', limit: '25 MB of attachments per email, sent or received', source: 'https://help.yahoo.com/kb/SLN5673.html' },
  discord: { where: 'Discord without Nitro', limit: '10 MB per file', source: 'https://support.discord.com/hc/en-us/articles/25444343291031' },
  passport: { where: 'US passport renewal online', limit: 'photo file between 54 KB and 10 MB, as JPG, PNG, HEIC or HEIF', source: 'https://travel.state.gov/en/passports/renew-replace/online/upload-digital-photo.html' },
};
