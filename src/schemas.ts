/**
 * Zod schemas for MCP tool parameters.
 */

import { z } from 'zod';

const authorizationEvidence = z.object({
  instruction: z.string().describe('What the human instructed (required for attested and verified).'),
  platform: z.string().describe('Platform that attested or verified the instruction (required for attested and verified).'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the instruction was given. Auto-set to now if omitted.'),
  user_signature: z.string().optional().describe("Cryptographic signature from user device (required for 'verified' modality only)."),
}).optional();

const scopePolicyValue = z.object({
  permissions: z.array(z.string()),
  exclusions: z.array(z.string()).optional(),
  minimum_authorization_modality: z.enum(['autonomous', 'attested', 'verified']).optional(),
  minimum_identity_assurance: z.enum(['self_registered', 'registered']).optional(),
  minimum_verification_tier: z.enum(['unverified', 'email_verified', 'domain_verified', 'org_verified']).optional(),
});

export const schemas = {
  discover: {
    agent_card_url: z.string().describe("URL of the target agent's agent card (e.g., 'https://example.com/.well-known/agent.json'). If a base domain is provided without a path, '/.well-known/agent.json' is appended automatically."),
  },

  register: {
    name: z.string().describe('Agent name. Lowercase alphanumeric and hyphens, 3-100 characters.'),
    type: z.enum(['personal', 'enterprise']).describe("Agent type. Use 'enterprise' for business agents, 'personal' for individual agents."),
    owner: z.string().describe('Organization or individual that owns this agent.'),
    scope_policies: z.record(z.string(), scopePolicyValue).optional().describe('Optional scope policies defining what interactions this agent accepts.'),
  },

  initiate_handshake: {
    target_agent_id: z.string().describe("Parafe agent ID of the agent to handshake with (starts with 'prf_agent_')."),
    scope: z.string().describe("Type of interaction (e.g., 'flight-rebooking', 'data-sharing', 'payment-processing')."),
    permissions: z.array(z.string()).describe('Specific actions you are requesting permission for within the scope.'),
    authorization_modality: z.enum(['autonomous', 'attested', 'verified']).optional().describe("Level of human authorization. 'autonomous' = agent acting alone (default). 'attested' = agent claims human instructed this. 'verified' = cryptographic proof of human approval."),
    authorization_evidence: authorizationEvidence.describe("Evidence for 'attested' or 'verified' modality. Required if modality is not 'autonomous'."),
    context: z.record(z.string(), z.unknown()).optional().describe('Optional context passed to the broker and visible in receipts (e.g., user ID, account reference).'),
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
    authorization_modality: z.enum(['autonomous', 'attested', 'verified']).optional(),
    authorization_evidence: authorizationEvidence,
  },

  verify_consent: {
    consent_token: z.string().describe('JWT consent token from a completed handshake.'),
    action: z.string().describe('Action to check permission for.'),
    session_id: z.string().describe('Session ID the consent token belongs to.'),
  },

  record_action: {
    session_id: z.string().describe('Active session ID.'),
    action: z.string().describe('Action being performed (should match a permission from the consent token).'),
    details: z.record(z.string(), z.unknown()).optional().describe('Optional details about the action (e.g., booking reference, data accessed).'),
    consent_token: z.string().optional().describe('Optional consent token. If provided, the broker validates the action is within scope.'),
  },

  close_session: {
    session_id: z.string().describe("Session ID to close (starts with 'sess_')."),
  },

  verify_receipt: {
    receipt: z.record(z.string(), z.unknown()).describe("Full receipt object including the 'signature' field, as returned by parafe_close_session."),
  },

  revoke_agent: {
    agent_id: z.string().describe("Agent ID to revoke (starts with 'prf_agent_')."),
  },

  renew_credential: {
    agent_id: z.string().describe('Agent ID to renew credentials for.'),
  },

  update_scope_policies: {
    agent_id: z.string().describe('Agent ID to update scope policies for.'),
    scope_policies: z.record(z.string(), scopePolicyValue).describe('New scope policies. Keys are scope names.'),
  },

  get_public_key: {},

  verify_consent_locally: {
    consent_token: z.string().describe('JWT consent token to verify.'),
    broker_public_key: z.string().describe("Broker's Ed25519 public key in base64 format (from parafe_get_public_key or the parafe://public-key resource)."),
  },

  get_agent_metrics: {
    agent_id: z.string().describe("Parafe agent ID to get metrics for (starts with 'prf_agent_')."),
  },
} as const;
