/**
 * Zod schemas for MCP tool parameters.
 */

import { z } from 'zod';

const authorizationEvidence = z.object({
  instruction: z.string().optional().describe("attested: what the human instructed."),
  platform: z.string().optional().describe('attested: the platform the instruction was given on.'),
  timestamp: z.string().optional().describe('attested: ISO 8601 timestamp of the instruction. Auto-set to now if omitted.'),
  ap2_mandate: z.string().optional().describe("delegated / verified: the user-signed AP2 mandate as presented (the ~~-joined Delegate SD-JWT chain)."),
  checkout_jwt: z.string().optional().describe('delegated / verified: the merchant-signed Checkout JWT, when the mandate needs it.'),
  checkout_hash: z.string().optional().describe("delegated / verified: a payment mandate's checkout hash, if you don't have the Checkout JWT."),
  checkout_mandate: z.string().optional().describe('delegated / verified: the checkout mandate a payment mandate belongs to.'),
}).optional();

const MODALITY_DESCRIPTION = "Level of human authorization, weakest to strongest. 'autonomous' = agent acting alone (default). 'attested' = agent states a human instructed this (evidence: instruction, platform). 'delegated' = the user signed an AP2 open mandate (limits) that endorses this agent's key, and this agent closed it (evidence: ap2_mandate). 'verified' = the user signed an AP2 mandate for this exact purchase (evidence: ap2_mandate). The broker checks delegated and verified mandates against the issuers the target trusts.";

const trustedIssuer = z.object({
  jwk: z.record(z.string(), z.unknown()).describe('The issuer public key as a JWK (EC P-256 in AP2).'),
  kid: z.string().optional(),
  iss: z.string().optional(),
  name: z.string().optional(),
}).strict();

const scopePolicyValue = z.object({
  permissions: z.array(z.string()),
  exclusions: z.array(z.string()).optional(),
  minimum_authorization_modality: z.enum(['autonomous', 'attested', 'delegated', 'verified']).optional(),
  minimum_identity_assurance: z.enum(['self_registered', 'registered', 'claimed']).optional(),
  minimum_verification_tier: z.enum(['unverified', 'email_verified', 'domain_verified', 'org_verified']).optional(),
  minimum_initiator_proof: z.enum(['pop', 'credential']).optional().describe("'pop': the initiator must prove it holds its key, not just show its credential."),
  minimum_tenure_days: z.number().int().min(0).optional().describe("Initiator's days since its first session, at least."),
  minimum_session_completion_rate: z.number().min(0).max(1).optional().describe('Share of its sessions it closed, at least (0 with no history).'),
  maximum_denied_requests_30d: z.number().int().min(0).optional().describe('Policy refusals of its requests in the last 30 days, at most.'),
  minimum_unique_counterparties: z.number().int().min(0).optional().describe('Distinct agents it has had sessions with, at least.'),
  minimum_handshake_success_rate: z.number().min(0).max(1).optional().describe('Share of its handshakes that succeeded, at least (0 with no history).'),
  ap2_trusted_issuers: z.array(trustedIssuer).optional().describe("AP2 mandate issuers this scope accepts for 'delegated' and 'verified'."),
  description: z.string().optional().describe('Informational; never enforced.'),
}).strict();

const ap2Receipt = {
  kind: z.enum(['checkout', 'payment']).describe("'checkout' answers a checkout mandate, 'payment' a payment mandate."),
  mandate: z.string().optional().describe('The mandate the receipt answers, as presented. Or pass references.'),
  references: z.object({ sdHash: z.string(), closedJwt: z.string() }).optional().describe('Instead of mandate: its references, as returned by parafe_verify_mandate.'),
  reference_form: z.enum(['closed_jwt', 'sd_hash']).optional().describe("Default 'closed_jwt' (what the AP2 SDK checks)."),
  iss: z.string().optional().describe("The receipt's issuer (the merchant or payment processor). Default: your agent's DID."),
  status: z.enum(['Success', 'Error']).optional().describe("Default 'Success', or 'Error' when error is set."),
  error: z.string().optional().describe('Error receipts: the AP2 error code, e.g. from parafe_verify_mandate.'),
  error_description: z.string().optional().describe('Error receipts: a short human-readable reason. Required with error.'),
  order_id: z.string().optional().describe('Checkout, Success: your order ID. Required.'),
  payment_id: z.string().optional().describe('Payment: the payment ID. Required.'),
  psp_confirmation_id: z.string().optional().describe('Payment, Success: the payment processor confirmation. Required.'),
  network_confirmation_id: z.string().optional().describe('Payment, Success: the card network confirmation. Required.'),
};

export const schemas = {
  discover: {
    agent_card_url: z.string().describe("URL of the target agent's agent card (e.g., 'https://example.com/.well-known/agent-card.json'), or just its domain. For a bare domain, '/.well-known/agent-card.json' is tried first, then '/.well-known/agent.json'."),
  },

  register: {
    name: z.string().describe('Agent name. Lowercase alphanumeric and hyphens, 3-100 characters.'),
    type: z.enum(['personal', 'enterprise']).describe("Agent type. Use 'enterprise' for business agents, 'personal' for individual agents."),
    owner: z.string().describe('Organization or individual that owns this agent.'),
    key_algorithm: z.enum(['Ed25519', 'P-256']).optional().describe("Key type. 'Ed25519' (default) or 'P-256' (ES256, the key type AP2 mandates use)."),
    scope_policies: z.record(z.string(), scopePolicyValue).optional().describe('Optional scope policies defining what interactions this agent accepts.'),
  },

  initiate_handshake: {
    target_agent_id: z.string().describe("Parafe agent ID of the agent to handshake with (starts with 'prf_agent_')."),
    scope: z.string().describe("Type of interaction (e.g., 'flight-rebooking', 'data-sharing', 'payment-processing')."),
    permissions: z.array(z.string()).describe('Specific actions you are requesting permission for within the scope.'),
    authorization_modality: z.enum(['autonomous', 'attested', 'delegated', 'verified']).optional().describe(MODALITY_DESCRIPTION),
    authorization_evidence: authorizationEvidence.describe("Evidence for the modality. Required if modality is not 'autonomous'."),
    context: z.record(z.string(), z.unknown()).optional().describe('Optional context stored by the broker with the handshake (e.g., user ID, account reference). It is not shown on the receipt.'),
  },

  complete_handshake: {
    handshake_id: z.string().describe("Handshake ID from the initiation (starts with 'hs_')."),
    challenge_nonce: z.string().describe('64-character hex nonce from the handshake initiation.'),
  },

  escalate_scope: {
    session_id: z.string().describe("Active session ID (starts with 'sess_')."),
    target_agent_id: z.string().describe('Target agent ID (must match the session participant).'),
    scope: z.string().describe('New scope to request.'),
    permissions: z.array(z.string()).describe('Actions for the new scope.'),
    authorization_modality: z.enum(['autonomous', 'attested', 'delegated', 'verified']).optional().describe(MODALITY_DESCRIPTION),
    authorization_evidence: authorizationEvidence,
  },

  verify_consent: {
    consent_token: z.string().describe('JWT consent token from a completed handshake.'),
    action: z.string().describe('Action to check permission for.'),
    session_id: z.string().describe('Session ID the consent token belongs to.'),
    presentation_proof: z.string().optional().describe('Optional: the presentation proof the initiator sent with the token.'),
  },

  record_action_receipt: {
    session_id: z.string().describe('Active session ID.'),
    consent_token: z.string().describe('The consent token the action was requested under.'),
    action: z.string().min(1).max(128).describe("The action, e.g. a permission name such as 'create_order'."),
    result: z.enum(['success', 'error']).optional().describe("Default 'success'."),
    error: z.enum(['not_permitted', 'excluded', 'consent_invalid', 'consent_expired', 'proof_invalid', 'failed']).optional()
      .describe("Required when result is 'error': why it was refused or failed."),
    error_description: z.string().max(500).optional().describe('Optional: a short human-readable reason.'),
    details: z.record(z.string(), z.unknown()).optional().describe('Optional details of what was done. Only their hash goes on the receipt.'),
    business_ref: z.string().max(256).optional().describe('Optional: your reference for the outcome, e.g. an order ID.'),
  },

  file_action_receipt: {
    session_id: z.string().describe('Session ID.'),
    receipt: z.string().describe('The receipt JWS, exactly as received.'),
    kind: z.enum(['parafe.action_receipt', 'ap2.checkout_receipt', 'ap2.payment_receipt']).optional().describe("Default 'parafe.action_receipt'."),
  },

  get_action_receipts: {
    session_id: z.string().describe("Session ID (starts with 'sess_')."),
  },

  close_session: {
    session_id: z.string().describe("Session ID to close (starts with 'sess_')."),
  },

  verify_receipt: {
    receipt: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("The receipt JWS string, or the receipt object returned by parafe_close_session / parafe_get_session_receipt."),
  },

  revoke_agent: {
    agent_id: z.string().regex(/^prf_agent_/, 'agent_id must start with "prf_agent_"').describe("Agent ID to revoke (starts with 'prf_agent_')."),
  },

  renew_credential: {
    agent_id: z.string().regex(/^prf_agent_/, 'agent_id must start with "prf_agent_"').describe('Agent ID to renew credentials for.'),
  },

  update_scope_policies: {
    agent_id: z.string().regex(/^prf_agent_/, 'agent_id must start with "prf_agent_"').describe('Agent ID to update scope policies for.'),
    scope_policies: z.record(z.string(), scopePolicyValue).describe('New scope policies. Keys are scope names.'),
  },

  get_public_key: {},

  create_claim_link: {},

  verify_consent_locally: {
    consent_token: z.string().describe('JWT consent token to verify.'),
    broker_public_key: z.string().optional().describe("Optional, legacy: the broker's Ed25519 key in base64, for tokens issued before 2026-09-30. Omit it: the broker's JWKS is fetched and cached."),
  },

  get_session_receipt: {
    session_id: z.string().describe("Session ID (starts with 'sess_')."),
  },

  create_presentation_proof: {
    consent_token: z.string().describe('The consent token you are presenting.'),
    message_id: z.string().optional().describe('Optional: the ID of the A2A message the token travels in.'),
  },

  verify_mandate: {
    mandate: z.string().min(1).describe('The AP2 mandate as presented: the ~~-joined Delegate SD-JWT chain.'),
    session_id: z.string().optional().describe('Optional: record the mandate in this session (you must be a participant).'),
    agent_id: z.string().regex(/^prf_agent_/, 'agent_id must start with "prf_agent_"').optional().describe('Optional: the verifying agent, when no agent credential is loaded.'),
    checkout_jwt: z.string().optional().describe("Optional: the merchant-signed Checkout JWT; for a payment mandate, the checkout it pays."),
    checkout_hash: z.string().optional().describe("Payment mandate: the expected transaction_id, if you don't hold the Checkout JWT."),
    checkout_mandate: z.string().optional().describe('Payment mandate: the checkout mandate chain it belongs to.'),
    expected_audience: z.string().optional().describe('Optional: the audience the presentation must name.'),
    expected_nonce: z.string().optional().describe('Optional: the nonce you gave the presenter.'),
    trusted_issuers: z.array(trustedIssuer).optional().describe("Issuers you accept (their public keys), added to the broker-wide list."),
    context: z.object({
      total_amount: z.number().int().min(0).optional().describe('Minor units spent so far.'),
      total_uses: z.number().int().min(0).optional().describe('Earlier uses.'),
      last_used_at: z.number().int().min(0).optional().describe('Last use, Unix seconds.'),
    }).strict().optional().describe('Budget and recurrence mandates: what has been used so far.'),
    redeem: z.boolean().optional().describe('Record the redemption (default true).'),
  },

  record_ap2_receipt: {
    session_id: z.string().describe('The session the purchase happened in.'),
    ...ap2Receipt,
  },

  sign_ap2_receipt: ap2Receipt,

  get_agent_metrics: {
    agent_id: z.string().regex(/^prf_agent_/, 'agent_id must start with "prf_agent_"').describe("Parafe agent ID to get metrics for (starts with 'prf_agent_')."),
  },
} as const;
