export type BeeperContact = {
  id: string;
  name: string;
  username?: string;
  phoneNumber?: string;
  email?: string;
  cannotMessage?: boolean;
  profileUnavailable?: boolean;
  profileUrl?: string;
  company?: string;
  position?: string;
  connectedOn?: string;
  names?: string[];
  emails?: string[];
  phoneNumbers?: string[];
  companies?: string[];
  positions?: string[];
  profileUrls?: string[];
  details?: Record<string, string[]>;
  messagingProfiles?: { accountId: string; participantId: string }[];
};
export type ContactAccount = {
  id: string;
  name: string;
  network: string;
  contacts: BeeperContact[];
  pages: number;
  fetchedAt: string | null;
  error?: string;
  source?:
    | "linkedin-portability"
    | "linkedin-session"
    | "email-contacts"
    | "conversation-extraction";
  emailAccountId?: string;
  emailProvider?: "google" | "microsoft";
  reconnectRequired?: boolean;
  apiDisabled?: boolean;
};
export type ContactsSnapshot = {
  updatedAt: string;
  accounts: ContactAccount[];
};
