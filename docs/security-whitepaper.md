# Security Whitepaper

## Overview
AEGIS provides robust protection against automated threats without compromising user privacy.

## Threat Model
We assume attackers have access to large proxies and headless browser farms. Our multi-layer approach ensures that bypassing one layer increases the likelihood of detection in subsequent layers.

## Compliance
- **GDPR / CCPA:** We do not collect PII. All fingerprinting data is hashed and salted.
- **OWASP:** We cover all 21 Automated Threat categories.

## Encryption
All data in transit is secured via TLS 1.3. Data at rest is encrypted using AES-256.
