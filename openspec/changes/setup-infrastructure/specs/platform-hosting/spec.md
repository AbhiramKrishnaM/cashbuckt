# Spec Delta

## Purpose

Defines how CashBuckt is reachable: HTTPS-only on the project domain (required for iOS Web Push and the Shortcuts webhook), with a health check and automatic recovery, and with the database never exposed to the internet.

## ADDED Requirements

### Requirement: HTTPS-only access on the project domain
The system SHALL serve all application traffic over HTTPS on the configured domain using a valid, publicly trusted certificate that renews automatically. Plain HTTP requests SHALL be permanently redirected to HTTPS.

#### Scenario: Valid certificate
- **WHEN** a client connects to `https://<DOMAIN>/`
- **THEN** the TLS handshake succeeds with a publicly trusted certificate for `<DOMAIN>` and the app responds

#### Scenario: HTTP redirected
- **WHEN** a client requests `http://<DOMAIN>/any/path`
- **THEN** the response is a permanent redirect (301 or 308) to `https://<DOMAIN>/any/path`

#### Scenario: Certificate renewal
- **WHEN** the certificate is within its renewal window
- **THEN** it is renewed without manual action and without downtime

### Requirement: Health endpoint
The system SHALL expose `GET /api/health`. It SHALL return HTTP 200 with JSON `{"status":"ok","db":"ok"}` when the database is reachable, and HTTP 503 with `{"status":"degraded","db":"down"}` when it is not. The response SHALL NOT include secrets, connection strings, or stack traces.

#### Scenario: Healthy
- **WHEN** the app and database are running and `GET /api/health` is called
- **THEN** the response is 200 with `{"status":"ok","db":"ok"}`

#### Scenario: Database unavailable
- **WHEN** the database container is stopped and `GET /api/health` is called
- **THEN** the response is 503 with `{"status":"degraded","db":"down"}` and no connection details in the body

### Requirement: Automatic recovery
All services SHALL restart automatically after a crash and after a host reboot, without manual intervention.

#### Scenario: Host reboot
- **WHEN** the droplet is rebooted
- **THEN** within 2 minutes of boot `GET https://<DOMAIN>/api/health` returns 200

#### Scenario: App crash
- **WHEN** the app process exits unexpectedly
- **THEN** it is restarted and the health endpoint returns 200 again

### Requirement: Restricted network exposure
The host SHALL accept inbound traffic only on ports 22 (SSH), 80, and 443. The database port SHALL NOT be reachable from outside the host. SSH SHALL accept key-based authentication only.

#### Scenario: Database port blocked
- **WHEN** a client outside the droplet attempts a TCP connection to `<droplet-ip>:5432`
- **THEN** the connection is refused or times out

#### Scenario: Password SSH rejected
- **WHEN** a client attempts SSH login with a password
- **THEN** authentication is rejected

### Requirement: Secrets kept out of the repository
Runtime secrets (database password, webhook secret, API keys, backup credentials) SHALL be supplied through an environment file on the host that is not tracked in git. The repository SHALL contain only a template listing the required keys.

#### Scenario: Missing required config
- **WHEN** the app starts without `DATABASE_URL` set
- **THEN** it fails fast with an error naming the missing variable, without printing any secret values
