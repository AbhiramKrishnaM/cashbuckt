# Spec Delta

## Purpose

Protects CashBuckt's financial history, which cannot be recreated once the original SMS are gone, with daily encrypted off-site backups, bounded retention, visible failure, and a restore path that has been proven to work.

## ADDED Requirements

### Requirement: Daily encrypted off-site backup
The system SHALL run a full database backup once per day at 02:00 Asia/Kolkata. Each backup SHALL be encrypted before it leaves the host and stored in off-site object storage. Unencrypted dumps SHALL NOT be uploaded or left on disk after the job finishes.

#### Scenario: Nightly run
- **WHEN** the clock reaches 02:00 IST
- **THEN** a new encrypted backup object named with its timestamp (e.g. `cashbuckt-2026-11-22T020000+0530.sql.gz.age`) appears in the backup bucket

#### Scenario: No plaintext leak
- **WHEN** the backup job completes, successfully or not
- **THEN** no unencrypted dump file remains on the host and every uploaded object is age-encrypted

### Requirement: Backups unreadable without the private key
Backups SHALL be encrypted to a public key whose private key is not stored on the droplet, so a compromised server or storage bucket does not expose backup contents.

#### Scenario: Server compromise
- **WHEN** an attacker has full access to the droplet and the backup bucket
- **THEN** they cannot decrypt any backup, because the decryption key exists only off the server

### Requirement: 30-day retention
Backups older than 30 days SHALL be deleted automatically. Backups 30 days old or newer SHALL be kept.

#### Scenario: Old backup pruned
- **WHEN** a backup object is 31 days old
- **THEN** it is deleted from the backup bucket

#### Scenario: Recent backups kept
- **WHEN** backups exist for each of the last 30 days
- **THEN** all 30 remain available

### Requirement: Backup failure is detectable
A successful backup SHALL signal a heartbeat to an external monitor. A missed or failed backup SHALL result in a notification to the owner within 26 hours, without the owner having to check logs.

#### Scenario: Upload fails
- **WHEN** the upload step fails (e.g. invalid Spaces credentials)
- **THEN** the job exits non-zero, logs the failure without printing secrets, sends no heartbeat, and the owner is notified by the external monitor

### Requirement: Verified restore
There SHALL be a documented restore procedure that decrypts a chosen backup and loads it into an empty database. The procedure SHALL have been run successfully at least once before go-live.

#### Scenario: Restore drill
- **WHEN** the latest backup is restored into a fresh, empty database by following the documented procedure
- **THEN** the row counts of every table match the source database at backup time
