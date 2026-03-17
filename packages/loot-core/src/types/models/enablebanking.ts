export type EnableBankingAspsp = {
  name: string;
  country: string;
  logo?: string;
};

export type SyncServerEnableBankingAccount = {
  balance: number;
  account_id: string;
  institution?: string;
  orgDomain?: string | null;
  orgId?: string;
  name: string;
};
