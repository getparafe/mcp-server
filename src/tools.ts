/**
 * MCP tool definitions for the Parafe Trust Broker.
 * Each tool maps to a ParafeClient SDK method (except parafe_discover).
 */

import { ParafeClient, type SignAp2ReceiptOptions, type VerifyMandateOptions, type Ap2TrustedIssuer } from '@getparafe/sdk';

// ── Tool name constants ──

export const TOOL_NAMES = {
  DISCOVER: 'parafe_discover',
  REGISTER: 'parafe_register',
  INITIATE_HANDSHAKE: 'parafe_initiate_handshake',
  COMPLETE_HANDSHAKE: 'parafe_complete_handshake',
  ESCALATE_SCOPE: 'parafe_escalate_scope',
  VERIFY_CONSENT: 'parafe_verify_consent',
  RECORD_ACTION_RECEIPT: 'parafe_record_action_receipt',
  FILE_ACTION_RECEIPT: 'parafe_file_action_receipt',
  GET_ACTION_RECEIPTS: 'parafe_get_action_receipts',
  CLOSE_SESSION: 'parafe_close_session',
  VERIFY_RECEIPT: 'parafe_verify_receipt',
  REVOKE_AGENT: 'parafe_revoke_agent',
  RENEW_CREDENTIAL: 'parafe_renew_credential',
  UPDATE_SCOPE_POLICIES: 'parafe_update_scope_policies',
  GET_PUBLIC_KEY: 'parafe_get_public_key',
  VERIFY_CONSENT_LOCALLY: 'parafe_verify_consent_locally',
  GET_AGENT_METRICS: 'parafe_get_agent_metrics',
  GET_SESSION_RECEIPT: 'parafe_get_session_receipt',
  CREATE_PRESENTATION_PROOF: 'parafe_create_presentation_proof',
  CREATE_CLAIM_LINK: 'parafe_create_claim_link',
  VERIFY_MANDATE: 'parafe_verify_mandate',
  SIGN_AP2_RECEIPT: 'parafe_sign_ap2_receipt',
  RECORD_AP2_RECEIPT: 'parafe_record_ap2_receipt',
} as const;

// ── Tool definitions (name, description, inputSchema) ──

export const TOOL_DEFINITIONS = [
  {
    name: TOOL_NAMES.DISCOVER,
    description: `Fetch a target agent's agent card to discover its Parafe trust requirements before initiating a handshake. Agent cards are hosted at the target's well-known URL: https://example.com/.well-known/agent-card.json (A2A v1.0), or /.well-known/agent.json on older A2A v0.3 agents. Pass just the domain and both are tried.

This is the first step before any handshake. The agent card tells you:
- Whether the target requires Parafe trust (look for the Parafe extension with 'required: true')
- The target's Parafe agent ID (needed for parafe_initiate_handshake)
- The broker URL
- Available scopes and their requirements: what permissions each scope grants, what authorization modality is required (autonomous, attested, delegated, or verified), and what minimum identity assurance level is needed
- The target's A2A endpoints and the A2A protocol version each one speaks (interfaces)

Always discover before handshaking. The agent card tells you whether your credentials meet the target's requirements — saving a round trip if they don't.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_card_url: {
          type: 'string',
          description: "URL of the target agent's agent card (e.g., 'https://example.com/.well-known/agent-card.json'), or just its domain. For a bare domain, '/.well-known/agent-card.json' is tried first, then '/.well-known/agent.json'.",
        },
      },
      required: ['agent_card_url'],
    },
  },
  {
    name: TOOL_NAMES.REGISTER,
    description: `Register a new agent identity with the Parafe trust network. This generates a key pair (P-256 by default, the key AP2 receipts need; Ed25519 on request), sends the public key to the Parafe broker, and receives a signed credential (a JWT, plus the same identity as an SD-JWT VC that binds your key). Call this once to establish your agent's identity — credentials are saved automatically and persist across sessions. Your private key never leaves this server; it signs a proof of possession on every request made as your agent.

You must register before you can initiate or complete trust handshakes. If you already have credentials loaded, this returns your existing agent info.

Registered without an API key, the agent has no owner (self_registered, unverified) and the result includes claimLink: show its url to the person you act for so they can verify you (see parafe_create_claim_link).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Agent name. Lowercase alphanumeric and hyphens, 3-100 characters.',
        },
        type: {
          type: 'string',
          enum: ['personal', 'enterprise'],
          description: "Agent type. Use 'enterprise' for business agents, 'personal' for individual agents.",
        },
        owner: {
          type: 'string',
          description: 'Organization or individual that owns this agent.',
        },
        key_algorithm: {
          type: 'string',
          enum: ['Ed25519', 'P-256'],
          description: "Key type. 'P-256' (default; ES256, the key type AP2 mandates and receipts use) or 'Ed25519'.",
        },
        scope_policies: {
          type: 'object',
          description: 'Optional scope policies defining what interactions this agent accepts.',
          additionalProperties: {
            type: 'object',
            properties: {
              permissions: { type: 'array', items: { type: 'string' } },
              exclusions: { type: 'array', items: { type: 'string' } },
              minimum_authorization_modality: { type: 'string', enum: ['autonomous', 'attested', 'delegated', 'verified'] },
              minimum_identity_assurance: { type: 'string', enum: ['self_registered', 'registered', 'claimed'] },
              minimum_verification_tier: { type: 'string', enum: ['unverified', 'email_verified', 'domain_verified', 'org_verified'] },
              minimum_initiator_proof: { type: 'string', enum: ['pop', 'credential'] },
              minimum_tenure_days: { type: 'integer', minimum: 0, description: "Reputation floor: the initiator's days since its first session." },
              minimum_session_completion_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Reputation floor: share of its sessions it closed.' },
              maximum_denied_requests_30d: { type: 'integer', minimum: 0, description: 'Reputation cap: policy refusals of its requests in the last 30 days.' },
              minimum_unique_counterparties: { type: 'integer', minimum: 0, description: 'Reputation floor: distinct agents it has had sessions with.' },
              minimum_handshake_success_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Reputation floor: share of its handshakes that succeeded.' },
              ap2_trusted_issuers: {
                type: 'array',
                description: "AP2 mandate issuers this scope accepts for 'delegated' and 'verified': public JWKs.",
                items: { type: 'object', properties: { jwk: { type: 'object' }, kid: { type: 'string' }, iss: { type: 'string' }, name: { type: 'string' } }, required: ['jwk'] },
              },
              description: { type: 'string' },
            },
            required: ['permissions'],
          },
        },
      },
      required: ['name', 'type', 'owner'],
    },
  },
  {
    name: TOOL_NAMES.INITIATE_HANDSHAKE,
    description: `Start a trust handshake with another agent. This begins a mutual authentication process where both agents cryptographically prove their identities before any interaction occurs.

You must specify:
- The target agent's Parafe ID
- A scope name describing the type of interaction (e.g., 'flight-rebooking', 'data-sharing')
- The specific permissions you're requesting within that scope

The target agent must complete the handshake (using parafe_complete_handshake) within 5 minutes. Once complete, you receive a scoped consent token that defines exactly what this interaction is authorized to do.

Use 'autonomous' authorization (default) when acting on your own. Use 'attested' when you're acting on a human's instruction. Use 'delegated' or 'verified' only with a user-signed AP2 mandate (authorization_evidence.ap2_mandate): 'delegated' for an open mandate the user gave you (limits) that you closed with your own key, 'verified' for a mandate the user signed for this exact purchase. The broker checks it against the issuers the target trusts, and each mandate works once.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_agent_id: {
          type: 'string',
          description: "Parafe agent ID of the agent to handshake with (starts with 'prf_agent_').",
        },
        scope: {
          type: 'string',
          description: "Type of interaction (e.g., 'flight-rebooking', 'data-sharing', 'payment-processing').",
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific actions you are requesting permission for within the scope.',
        },
        authorization_modality: {
          type: 'string',
          enum: ['autonomous', 'attested', 'delegated', 'verified'],
          description: "Level of human authorization, weakest to strongest. 'autonomous' = agent acting alone (default). 'attested' = agent states a human instructed this. 'delegated' = an AP2 open mandate the user signed, closed with your key. 'verified' = an AP2 mandate the user signed for this exact purchase.",
        },
        authorization_evidence: {
          type: 'object',
          description: "Evidence for the modality. Required if modality is not 'autonomous'.",
          properties: {
            instruction: { type: 'string', description: 'attested: what the human instructed.' },
            platform: { type: 'string', description: 'attested: the platform the instruction was given on.' },
            timestamp: { type: 'string', description: 'attested: ISO 8601 timestamp of the instruction. Auto-set to now if omitted.' },
            ap2_mandate: { type: 'string', description: 'delegated / verified: the user-signed AP2 mandate as presented (~~-joined Delegate SD-JWT chain).' },
            checkout_jwt: { type: 'string', description: 'delegated / verified: the merchant-signed Checkout JWT, when the mandate needs it.' },
            checkout_hash: { type: 'string', description: "delegated / verified: a payment mandate's checkout hash." },
            checkout_mandate: { type: 'string', description: 'delegated / verified: the checkout mandate a payment mandate belongs to.' },
          },
        },
        context: {
          type: 'object',
          description: 'Optional context stored by the broker with the handshake (e.g., user ID, account reference). It is not shown on the receipt.',
        },
      },
      required: ['target_agent_id', 'scope', 'permissions'],
    },
  },
  {
    name: TOOL_NAMES.COMPLETE_HANDSHAKE,
    description: `Complete a trust handshake that another agent initiated with you. This signs the cryptographic challenge with your private key, proving your identity to the Parafe broker.

You need the handshake_id and challenge_nonce from the initiation. The handshake must be completed within 5 minutes of initiation.

On success, returns a session with a scoped consent token defining what both agents are authorized to do.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        handshake_id: {
          type: 'string',
          description: "Handshake ID from the initiation (starts with 'hs_').",
        },
        challenge_nonce: {
          type: 'string',
          description: '64-character hex nonce from the handshake initiation.',
        },
      },
      required: ['handshake_id', 'challenge_nonce'],
    },
  },
  {
    name: TOOL_NAMES.ESCALATE_SCOPE,
    description: `Request additional permissions within an existing authenticated session. This avoids re-handshaking when the interaction needs to expand beyond its original scope.

For example, if a flight-rebooking session needs to also process a payment, you can escalate from 'flight-rebooking' scope to add 'payment-processing' scope within the same session. A new consent token is issued for the escalated scope.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Active session ID (starts with 'sess_').",
        },
        target_agent_id: {
          type: 'string',
          description: 'Target agent ID (must match the session participant).',
        },
        scope: {
          type: 'string',
          description: 'New scope to request.',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Actions for the new scope.',
        },
        authorization_modality: {
          type: 'string',
          enum: ['autonomous', 'attested', 'delegated', 'verified'],
        },
        authorization_evidence: {
          type: 'object',
          properties: {
            instruction: { type: 'string', description: 'attested: what the human instructed.' },
            platform: { type: 'string', description: 'attested: the platform the instruction was given on.' },
            timestamp: { type: 'string', description: 'attested: ISO 8601 timestamp of the instruction. Auto-set to now if omitted.' },
            ap2_mandate: { type: 'string', description: 'delegated / verified: the user-signed AP2 mandate as presented (~~-joined Delegate SD-JWT chain).' },
            checkout_jwt: { type: 'string', description: 'delegated / verified: the merchant-signed Checkout JWT, when the mandate needs it.' },
            checkout_hash: { type: 'string', description: "delegated / verified: a payment mandate's checkout hash." },
            checkout_mandate: { type: 'string', description: 'delegated / verified: the checkout mandate a payment mandate belongs to.' },
          },
        },
      },
      required: ['session_id', 'target_agent_id', 'scope', 'permissions'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT,
    description: `Check whether a specific action is permitted by a consent token before performing it. Call this before taking any scoped action to ensure you're operating within the agreed boundaries.

Returns whether the action is permitted, and if not, why (e.g., action is in the exclusion list, token expired, scope mismatch, an agent was revoked). Consent tokens are bound to the initiator's key: if the initiator sent a presentation proof with the token, pass it as presentation_proof and the broker checks it (a stolen token without the initiator's key fails).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'JWT consent token from a completed handshake.',
        },
        action: {
          type: 'string',
          description: 'Action to check permission for.',
        },
        session_id: {
          type: 'string',
          description: 'Session ID the consent token belongs to.',
        },
        presentation_proof: {
          type: 'string',
          description: "Optional: the presentation proof the initiator sent with the token (from its parafe_create_presentation_proof).",
        },
      },
      required: ['consent_token', 'action', 'session_id'],
    },
  },
  {
    name: TOOL_NAMES.RECORD_ACTION_RECEIPT,
    description: `Record what you did (or refused) in a session with a signed action receipt. You sign it with your agent's key, bound to the consent token you were asked under, and the broker adds it to the session's index; the session receipt lists every action receipt. Returns the receipt (a JWS: send it back to the other agent) and the broker's signed acknowledgment.

Call it after each action you perform for the other agent: result 'success', or result 'error' with error 'failed' if you tried and it failed. Call it too when you refuse a request because the consent token doesn't allow it: result 'error' with error 'excluded' (the action is excluded), 'not_permitted' (not in the token's permissions), 'consent_expired', 'consent_invalid' or 'proof_invalid'. Do this before the session is closed. The broker sees the action name, the result and business_ref, never details (only their hash).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Active session ID.' },
        consent_token: { type: 'string', description: 'The consent token the action was requested under.' },
        action: { type: 'string', description: "The action, e.g. a permission name such as 'create_order'." },
        result: { type: 'string', enum: ['success', 'error'], description: "Default 'success'." },
        error: {
          type: 'string',
          enum: ['not_permitted', 'excluded', 'consent_invalid', 'consent_expired', 'proof_invalid', 'failed'],
          description: "Required when result is 'error': why it was refused or failed.",
        },
        error_description: { type: 'string', description: 'Optional: a short human-readable reason.' },
        details: { type: 'object', description: 'Optional details of what was done. Only their hash goes on the receipt.' },
        business_ref: { type: 'string', description: 'Optional: your reference for the outcome, e.g. an order ID (visible to the broker).' },
      },
      required: ['session_id', 'consent_token', 'action'],
    },
  },
  {
    name: TOOL_NAMES.FILE_ACTION_RECEIPT,
    description: `File an action receipt the other agent gave you (or an AP2 Checkout/Payment Receipt, with its kind) in the session's index, so it is on the session receipt even if the other agent never files it. Filing the same receipt twice is harmless: you get the original acknowledgment back (duplicate: true). File before the session is closed.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session ID.' },
        receipt: { type: 'string', description: 'The receipt JWS, exactly as received.' },
        kind: {
          type: 'string',
          enum: ['parafe.action_receipt', 'ap2.checkout_receipt', 'ap2.payment_receipt'],
          description: "Default 'parafe.action_receipt'.",
        },
      },
      required: ['session_id', 'receipt'],
    },
  },
  {
    name: TOOL_NAMES.GET_ACTION_RECEIPTS,
    description: `List a session's index: every action receipt filed so far (who signed it, the action, the result, the broker's acknowledgment) and the chain head. Either participant can, before or after close.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: "Session ID (starts with 'sess_')." },
      },
      required: ['session_id'],
    },
  },
  {
    name: TOOL_NAMES.CLOSE_SESSION,
    description: `Close an active session and get its signed receipt. The receipt ('receipt' field) is a compact JWS signed by the broker (ES256): who participated, mutual authentication, every consent token issued in the session (scope, permissions, exclusions, authorization modality, how the initiator proved itself), and when. The human's instruction and the handshake context appear only as hashes. It lists every action receipt filed in the session (see parafe_record_action_receipt) and the index's chain head. The other fields are a readable copy decoded from the JWS.

Either participant may close; the other one can fetch the same receipt with parafe_get_session_receipt. Anyone holding the JWS can independently verify it against the broker's published keys. It serves as neutral, tamper-proof evidence of the session's trust context.

Always close sessions when the interaction is complete, after filing your action receipts: receipts filed after close are refused.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Session ID to close (starts with 'sess_').",
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_RECEIPT,
    description: `Verify a receipt's signature to confirm it was genuinely issued by the Parafe broker and has not been tampered with. Use this to independently validate interaction records.

Pass the receipt JWS (the 'receipt' field from parafe_close_session or parafe_get_session_receipt), or the whole object returned by those tools. Receipts from before 2026-09-30 (signed JSON) also verify. Returns whether the signature is valid, whether tampering was detected, and the verified claims.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        receipt: {
          type: ['string', 'object'],
          description: "The receipt JWS string, or the receipt object returned by parafe_close_session / parafe_get_session_receipt.",
        },
      },
      required: ['receipt'],
    },
  },
  {
    name: TOOL_NAMES.REVOKE_AGENT,
    description: `Permanently revoke an agent's identity. The agent's credentials become invalid and it can no longer participate in handshakes. This cannot be undone.

Use this when an agent should be decommissioned or if credentials may have been compromised.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: "Agent ID to revoke (starts with 'prf_agent_').",
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.RENEW_CREDENTIAL,
    description: `Renew an agent's credential. The broker re-issues it when the owner's verification tier has changed (e.g. after email or domain verification), when the credential doesn't show the agent's current owner yet (identity_changed, e.g. after someone claimed it), or when the credential is expired or within 7 days of expiry; otherwise it returns renewed: false.

Credentials expire after 30 days. Renew in the last week to keep trust capabilities uninterrupted.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to renew credentials for.',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.CREATE_CLAIM_LINK,
    description: `Get a claim link for this agent, when it registered without an API key and has no owner. Show the url to the person you act for: they open it, sign in to Parafé (or create an account) and approve, and you become their agent (identity assurance 'claimed', their verification tier). Services that refuse self-registered or unverified agents then accept you. No secret passes through you: the link only works for a signed-in person who approves it.

The link is single use and lasts 30 minutes; a new one replaces the old. A handshake refused for identity or tier (identity_insufficient, tier_insufficient) also returns a claim link. After approval, call parafe_renew_credential so your credential shows it. Fails with already_claimed if you already have an owner.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.UPDATE_SCOPE_POLICIES,
    description: `Update the scope policies that define what interactions this agent accepts. Scope policies let you declare which permissions you allow, which you exclude, and what minimum trust requirements counterparties must meet.

For example, you can require that any agent requesting 'payment-processing' scope must have 'verified' authorization modality and 'domain_verified' verification tier.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent ID to update scope policies for.',
        },
        scope_policies: {
          type: 'object',
          description: 'New scope policies. Keys are scope names. Each value defines permissions (required), exclusions, and minimum trust requirements.',
          additionalProperties: {
            type: 'object',
            properties: {
              permissions: { type: 'array', items: { type: 'string' } },
              exclusions: { type: 'array', items: { type: 'string' } },
              minimum_authorization_modality: { type: 'string', enum: ['autonomous', 'attested', 'delegated', 'verified'] },
              minimum_identity_assurance: { type: 'string', enum: ['self_registered', 'registered', 'claimed'] },
              minimum_verification_tier: { type: 'string', enum: ['unverified', 'email_verified', 'domain_verified', 'org_verified'] },
              minimum_initiator_proof: { type: 'string', enum: ['pop', 'credential'] },
              minimum_tenure_days: { type: 'integer', minimum: 0, description: "Reputation floor: the initiator's days since its first session." },
              minimum_session_completion_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Reputation floor: share of its sessions it closed.' },
              maximum_denied_requests_30d: { type: 'integer', minimum: 0, description: 'Reputation cap: policy refusals of its requests in the last 30 days.' },
              minimum_unique_counterparties: { type: 'integer', minimum: 0, description: 'Reputation floor: distinct agents it has had sessions with.' },
              minimum_handshake_success_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Reputation floor: share of its handshakes that succeeded.' },
              ap2_trusted_issuers: {
                type: 'array',
                description: "AP2 mandate issuers this scope accepts for 'delegated' and 'verified': public JWKs.",
                items: { type: 'object', properties: { jwk: { type: 'object' }, kid: { type: 'string' }, iss: { type: 'string' }, name: { type: 'string' } }, required: ['jwk'] },
              },
              description: { type: 'string' },
            },
            required: ['permissions'],
          },
        },
      },
      required: ['agent_id', 'scope_policies'],
    },
  },
  {
    name: TOOL_NAMES.GET_PUBLIC_KEY,
    description: `Get the Parafe broker's signing keys (a JWKS). Every Parafe-signed artifact (credential, consent token, receipt) names the key that signed it (kid); with these keys anyone can verify it without calling the broker. The active key is ES256; the Ed25519 key that signed artifacts before 2026-09-30 is listed as retired.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_CONSENT_LOCALLY,
    description: `Verify a consent token locally against the broker's published keys — no broker round-trip per token (the keys are fetched once and cached). Use this when you need to validate a consent token offline or in a latency-sensitive path.

Returns the token's scope, permissions, exclusions, session, initiator, audience, the key it's bound to, and how the initiator proved itself, or an error if the signature is invalid. Expired tokens return expired: true.

Use parafe_verify_consent (network round-trip) when you also want the broker to check the action against scope policy. Use this tool when you only need signature and expiry validation.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'JWT consent token to verify.',
        },
        broker_public_key: {
          type: 'string',
          description: "Optional, legacy: the broker's Ed25519 key in base64, for tokens issued before 2026-09-30. Omit it: the broker's JWKS is fetched and cached.",
        },
      },
      required: ['consent_token'],
    },
  },
  {
    name: TOOL_NAMES.GET_AGENT_METRICS,
    description: `Retrieve reputation metrics for a Parafe-registered agent. Returns the raw trust signals that indicate how trustworthy an agent is based on its interaction history: session completion rate, unique counterparties, tenure, handshake success rate, and denied scope requests.

Use this before deciding whether to interact with an agent — especially self_registered agents — to assess their track record. Does not return a score; returns the signals a score would be built from.

Key signals:
- tenure_days: How long the agent has been active
- completion_rate: Ratio of successfully closed sessions to total sessions (0–1)
- unique_counterparties: How many distinct agents this agent has interacted with
- handshake_success_rate: Ratio of successful handshakes to total attempts (0–1)
- denied_scope_requests: How many times this agent's consent token requests were rejected by policy (wrong modality, insufficient assurance, insufficient tier)

Higher tenure, completion rate, counterparty count, and handshake success rate indicate a more trustworthy agent. Higher denied scope requests may indicate an agent repeatedly requesting access it isn't authorized for.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: "Parafe agent ID to get metrics for (starts with 'prf_agent_').",
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: TOOL_NAMES.GET_SESSION_RECEIPT,
    description: `Fetch the signed receipt of a closed session. Either participant can, not only the one that closed it. Use this when the other agent closed the session. Returns the receipt JWS ('receipt') and a readable copy decoded from it, like parafe_close_session. Fails if the session isn't closed yet.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: "Session ID (starts with 'sess_').",
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: TOOL_NAMES.CREATE_PRESENTATION_PROOF,
    description: `Create the presentation proof to send along with a consent token when you present it to the target agent (for example in the Parafe A2A extension's consent data, field 'proof'). Consent tokens are bound to your key; the proof, signed with your private key, shows the target that the token is being presented by its rightful holder. Make a fresh proof for every message.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consent_token: {
          type: 'string',
          description: 'The consent token you are presenting.',
        },
        message_id: {
          type: 'string',
          description: 'Optional: the ID of the A2A message the token travels in, so the proof only fits that message.',
        },
      },
      required: ['consent_token'],
    },
  },
  {
    name: TOOL_NAMES.VERIFY_MANDATE,
    description: `Have the broker verify an AP2 mandate another agent presented to you, when you are the merchant (checkout mandate) or the payment processor (payment mandate). The broker checks the Delegate SD-JWT chain against the issuers you trust (trusted_issuers, plus the broker's list), every constraint, and the checkout binding.

Returns valid; when invalid, the AP2 error code to put in your receipt (error, reason, violations). It also returns the receipt references, who signed the mandate (closedBy, openedBy), and the registered Parafé agent holding the mandate's agent key (agent, with isCounterparty in a session). The broker records the redemption: presenting the same mandate or checkout again gets alreadyRedeemed: true. Pass redeem: false to check without redeeming.

Pass session_id to record the mandate in a session you are in: receipts in that session that name it are then marked reference_verified. Accept or reject the purchase, then answer with parafe_record_ap2_receipt (in a session) or parafe_sign_ap2_receipt: AP2 says the merchant must return a receipt either way.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        mandate: { type: 'string', description: 'The AP2 mandate as presented: the ~~-joined Delegate SD-JWT chain.' },
        session_id: { type: 'string', description: "Optional: record the mandate in this session (you must be a participant)." },
        agent_id: { type: 'string', description: 'Optional: the verifying agent, when no agent credential is loaded (authenticates with the API key).' },
        checkout_jwt: { type: 'string', description: "Optional: the merchant-signed Checkout JWT, when the checkout mandate doesn't disclose it; for a payment mandate, the checkout it pays." },
        checkout_hash: { type: 'string', description: "Payment mandate: the expected transaction_id, if you don't hold the Checkout JWT." },
        checkout_mandate: { type: 'string', description: 'Payment mandate: the checkout mandate chain it belongs to.' },
        expected_audience: { type: 'string', description: "Optional: the audience the presentation must name (your DID or agent ID)." },
        expected_nonce: { type: 'string', description: 'Optional: the nonce you gave the presenter.' },
        trusted_issuers: {
          type: 'array',
          description: 'Issuers you accept (their public keys), added to the broker-wide list.',
          items: {
            type: 'object',
            properties: { jwk: { type: 'object' }, kid: { type: 'string' }, iss: { type: 'string' }, name: { type: 'string' } },
            required: ['jwk'],
          },
        },
        context: {
          type: 'object',
          description: 'Budget and recurrence mandates: what has been used so far.',
          properties: {
            total_amount: { type: 'number', description: 'Minor units spent so far.' },
            total_uses: { type: 'number', description: 'Earlier uses.' },
            last_used_at: { type: 'number', description: 'Last use, Unix seconds.' },
          },
        },
        redeem: { type: 'boolean', description: 'Record the redemption (default true).' },
      },
      required: ['mandate'],
    },
  },
  {
    name: TOOL_NAMES.RECORD_AP2_RECEIPT,
    description: `Sign an AP2 Checkout or Payment Receipt as your agent and file it in the session's index, in one call. Use it after you accept or reject a purchase under an AP2 mandate (see parafe_verify_mandate): AP2 says the merchant must return a receipt either way. Returns the receipt JWT (send it back to the shopping agent), its reference, and the broker's acknowledgment, which says whether the reference matches a mandate verified in the session (reference_verified).

Success: a checkout receipt needs order_id; a payment receipt needs payment_id, psp_confirmation_id and network_confirmation_id. Error: pass error (the AP2 code) and error_description (a payment receipt still needs payment_id). AP2 receipts are ES256, so your agent needs a P-256 key (parafe_register's default). File before the session is closed.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session the purchase happened in.' },
        kind: { type: 'string', enum: ['checkout', 'payment'], description: "'checkout' answers a checkout mandate, 'payment' a payment mandate." },
        mandate: { type: 'string', description: 'The mandate the receipt answers, as presented (the ~~-joined Delegate SD-JWT chain). Or pass references.' },
        references: {
          type: 'object',
          description: 'Instead of mandate: its references, as returned by parafe_verify_mandate.',
          properties: { sdHash: { type: 'string' }, closedJwt: { type: 'string' } },
          required: ['sdHash', 'closedJwt'],
        },
        reference_form: { type: 'string', enum: ['closed_jwt', 'sd_hash'], description: "Which reference goes in the receipt. Default 'closed_jwt' (what the AP2 SDK checks)." },
        iss: { type: 'string', description: "The receipt's issuer (the merchant or payment processor). Default: your agent's DID." },
        status: { type: 'string', enum: ['Success', 'Error'], description: "Default 'Success', or 'Error' when error is set." },
        error: { type: 'string', description: "Error receipts: the AP2 error code, e.g. parafe_verify_mandate's error (invalid_credential, unresolved_constraint, invalid_mandate, mandates_not_supported)." },
        error_description: { type: 'string', description: 'Error receipts: a short human-readable reason. Required with error.' },
        order_id: { type: 'string', description: 'Checkout, Success: your order ID. Required.' },
        payment_id: { type: 'string', description: 'Payment: the payment ID. Required.' },
        psp_confirmation_id: { type: 'string', description: 'Payment, Success: the payment processor confirmation. Required.' },
        network_confirmation_id: { type: 'string', description: 'Payment, Success: the card network confirmation. Required.' },
      },
      required: ['session_id', 'kind'],
    },
  },
  {
    name: TOOL_NAMES.SIGN_AP2_RECEIPT,
    description: `Sign an AP2 Checkout or Payment Receipt as your agent without filing it anywhere: for a purchase outside a Parafé session. In a session, use parafe_record_ap2_receipt instead, so the receipt is on the session receipt. Returns the receipt JWT to send back to the shopping agent, and its reference.

Same fields as parafe_record_ap2_receipt: a Success checkout receipt needs order_id; a payment receipt needs payment_id (and, for Success, psp_confirmation_id and network_confirmation_id); an Error receipt needs error and error_description. Needs a P-256 agent key.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        kind: { type: 'string', enum: ['checkout', 'payment'], description: "'checkout' answers a checkout mandate, 'payment' a payment mandate." },
        mandate: { type: 'string', description: 'The mandate the receipt answers, as presented (the ~~-joined Delegate SD-JWT chain). Or pass references.' },
        references: {
          type: 'object',
          description: 'Instead of mandate: its references, as returned by parafe_verify_mandate.',
          properties: { sdHash: { type: 'string' }, closedJwt: { type: 'string' } },
          required: ['sdHash', 'closedJwt'],
        },
        reference_form: { type: 'string', enum: ['closed_jwt', 'sd_hash'], description: "Which reference goes in the receipt. Default 'closed_jwt' (what the AP2 SDK checks)." },
        iss: { type: 'string', description: "The receipt's issuer (the merchant or payment processor). Default: your agent's DID." },
        status: { type: 'string', enum: ['Success', 'Error'], description: "Default 'Success', or 'Error' when error is set." },
        error: { type: 'string', description: "Error receipts: the AP2 error code, e.g. parafe_verify_mandate's error (invalid_credential, unresolved_constraint, invalid_mandate, mandates_not_supported)." },
        error_description: { type: 'string', description: 'Error receipts: a short human-readable reason. Required with error.' },
        order_id: { type: 'string', description: 'Checkout, Success: your order ID. Required.' },
        payment_id: { type: 'string', description: 'Payment: the payment ID. Required.' },
        psp_confirmation_id: { type: 'string', description: 'Payment, Success: the payment processor confirmation. Required.' },
        network_confirmation_id: { type: 'string', description: 'Payment, Success: the card network confirmation. Required.' },
      },
      required: ['kind'],
    },
  },
];

// ── Authorization builder helper ──

interface AuthorizationEvidence {
  instruction?: string;
  platform?: string;
  timestamp?: string;
  ap2_mandate?: string;
  checkout_jwt?: string;
  checkout_hash?: string;
  checkout_mandate?: string;
}

export function buildAuthorization(modality?: string, evidence?: AuthorizationEvidence) {
  if (!modality || modality === 'autonomous') {
    return ParafeClient.authorization.autonomous();
  }
  if (modality === 'attested') {
    return ParafeClient.authorization.attested({
      instruction: evidence?.instruction ?? '',
      platform: evidence?.platform ?? '',
      timestamp: evidence?.timestamp,
    });
  }
  if (modality === 'delegated' || modality === 'verified') {
    // B8: the broker checks the AP2 mandate; the SDK refuses a missing one.
    const opts = {
      mandate: evidence?.ap2_mandate ?? '',
      ...(evidence?.checkout_jwt ? { checkoutJwt: evidence.checkout_jwt } : {}),
      ...(evidence?.checkout_hash ? { checkoutHash: evidence.checkout_hash } : {}),
      ...(evidence?.checkout_mandate ? { checkoutMandate: evidence.checkout_mandate } : {}),
    };
    return modality === 'delegated' ? ParafeClient.authorization.delegated(opts) : ParafeClient.authorization.verified(opts);
  }
  throw new Error(`Unknown authorization modality '${modality}'`);
}

// ── AP2 argument mapping (snake_case tool arguments to SDK options) ──

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export function buildVerifyMandateOptions(args: Args): VerifyMandateOptions {
  const context = args.context as { total_amount?: number; total_uses?: number; last_used_at?: number } | undefined;
  const opts: VerifyMandateOptions = { mandate: String(args.mandate ?? '') };
  if (str(args.session_id)) opts.sessionId = str(args.session_id);
  if (str(args.agent_id)) opts.agentId = str(args.agent_id);
  if (str(args.checkout_jwt)) opts.checkoutJwt = str(args.checkout_jwt);
  if (str(args.checkout_hash)) opts.checkoutHash = str(args.checkout_hash);
  if (str(args.checkout_mandate)) opts.checkoutMandate = str(args.checkout_mandate);
  if (str(args.expected_audience)) opts.expectedAudience = str(args.expected_audience);
  if (str(args.expected_nonce)) opts.expectedNonce = str(args.expected_nonce);
  if (Array.isArray(args.trusted_issuers)) opts.trustedIssuers = args.trusted_issuers as Ap2TrustedIssuer[];
  if (context) {
    opts.context = {
      ...(context.total_amount !== undefined ? { totalAmount: context.total_amount } : {}),
      ...(context.total_uses !== undefined ? { totalUses: context.total_uses } : {}),
      ...(context.last_used_at !== undefined ? { lastUsedAt: context.last_used_at } : {}),
    };
  }
  if (typeof args.redeem === 'boolean') opts.redeem = args.redeem;
  return opts;
}

export function buildAp2ReceiptOptions(args: Args): SignAp2ReceiptOptions {
  const opts: SignAp2ReceiptOptions = { kind: args.kind as 'checkout' | 'payment' };
  if (str(args.mandate)) opts.mandate = str(args.mandate);
  if (args.references) opts.references = args.references as SignAp2ReceiptOptions['references'];
  if (str(args.reference_form)) opts.referenceForm = args.reference_form as 'closed_jwt' | 'sd_hash';
  if (str(args.iss)) opts.iss = str(args.iss);
  if (str(args.status)) opts.status = args.status as 'Success' | 'Error';
  if (str(args.error)) opts.error = str(args.error);
  if (str(args.error_description)) opts.errorDescription = str(args.error_description);
  if (str(args.order_id)) opts.orderId = str(args.order_id);
  if (str(args.payment_id)) opts.paymentId = str(args.payment_id);
  if (str(args.psp_confirmation_id)) opts.pspConfirmationId = str(args.psp_confirmation_id);
  if (str(args.network_confirmation_id)) opts.networkConfirmationId = str(args.network_confirmation_id);
  return opts;
}
