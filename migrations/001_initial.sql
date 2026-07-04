CREATE TABLE subscription_keys (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key_hash BYTEA NOT NULL UNIQUE,
    key_hint VARCHAR(6) NOT NULL,
    telegram_id BIGINT,
    invalid_telegram_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    CONSTRAINT subscription_keys_hash_length CHECK (OCTET_LENGTH(key_hash) = 32),
    CONSTRAINT subscription_keys_hint_length CHECK (CHAR_LENGTH(key_hint::TEXT) = 6),
    CONSTRAINT subscription_keys_telegram_id CHECK (telegram_id IS NULL OR telegram_id > 0),
    CONSTRAINT subscription_keys_invalid_telegram_id CHECK (
        invalid_telegram_id IS NULL OR invalid_telegram_id > 0
    ),
    CONSTRAINT subscription_keys_activation_state CHECK (
        (
            telegram_id IS NULL
            AND activated_at IS NULL
            AND expires_at IS NULL
        )
        OR
        (
            telegram_id IS NOT NULL
            AND activated_at IS NOT NULL
            AND expires_at IS NOT NULL
            AND expires_at > activated_at
        )
    )
);

CREATE INDEX subscription_keys_expires_at_idx
    ON subscription_keys (expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TABLE telegram_users (
    telegram_id BIGINT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rentals (
    id UUID PRIMARY KEY,
    subscription_key_id BIGINT NOT NULL
        REFERENCES subscription_keys(id)
        ON DELETE CASCADE,
    property_name VARCHAR(100) NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    original_end_at TIMESTAMPTZ NOT NULL,
    total NUMERIC(12, 2) NOT NULL,
    telegram_id BIGINT NOT NULL,
    notified_at TIMESTAMPTZ,
    ended_early BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rentals_property_name CHECK (property_name <> ''),
    CONSTRAINT rentals_dates CHECK (end_at > start_at),
    CONSTRAINT rentals_original_dates CHECK (original_end_at > start_at),
    CONSTRAINT rentals_total CHECK (total >= 0 AND total <= 1000000000),
    CONSTRAINT rentals_telegram_id CHECK (telegram_id > 0)
);

CREATE INDEX rentals_subscription_key_id_idx ON rentals (subscription_key_id);
CREATE INDEX rentals_telegram_id_idx ON rentals (telegram_id);
CREATE INDEX rentals_pending_notification_idx
    ON rentals (end_at)
    WHERE notified_at IS NULL;

CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL UNIQUE,
    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payments_order_id CHECK (order_id <> ''),
    CONSTRAINT payments_amount CHECK (amount >= 0 AND amount <= 1000000000),
    CONSTRAINT payments_status CHECK (status <> '')
);

CREATE UNIQUE INDEX payments_transaction_id_idx
    ON payments (transaction_id)
    WHERE transaction_id IS NOT NULL;
