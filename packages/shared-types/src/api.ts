export interface ApiResponse<T> { data: T; error?: string; }
export interface PaginatedResponse<T> { data: T[]; total: number; page: number; pageSize: number; }
export interface CreateApiKeyRequest { name: string; }
export interface CreateApiKeyResponse { key: string; keyPrefix: string; createdAt: string; }
export interface CreateOrgRequest { name: string; slug: string; }
export interface InviteMemberRequest { email: string; role: "admin" | "member" | "viewer"; }
export interface CreateWebhookRequest { url: string; events: string[]; }
