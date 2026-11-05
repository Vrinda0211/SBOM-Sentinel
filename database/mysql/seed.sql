INSERT INTO LICENSE (license_id, license_name, spdx_identifier, license_type)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'MIT License', 'MIT', 'permissive'),
    ('00000000-0000-4000-8000-000000000002', 'Apache License 2.0', 'Apache-2.0', 'permissive'),
    ('00000000-0000-4000-8000-000000000003', 'GNU General Public License v3.0', 'GPL-3.0-only', 'copyleft')
ON DUPLICATE KEY UPDATE
    license_name = VALUES(license_name),
    license_type = VALUES(license_type);

INSERT INTO COMPONENT (component_id, component_name, component_type)
VALUES
    ('00000000-0000-4000-8000-000000000011', 'express', 'npm'),
    ('00000000-0000-4000-8000-000000000012', 'lodash', 'npm'),
    ('00000000-0000-4000-8000-000000000013', 'react', 'npm'),
    ('00000000-0000-4000-8000-000000000014', 'qs', 'npm')
ON DUPLICATE KEY UPDATE
    component_name = VALUES(component_name),
    component_type = VALUES(component_type);

INSERT INTO COMPONENT_VERSION (
    component_version_id,
    component_id,
    license_id,
    version_number,
    release_date
)
VALUES
    ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '4.18.2', '2022-10-08'),
    ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', '4.17.20', '2021-10-18'),
    ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '18.2.0', '2022-06-14'),
    ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', '6.10.2', '2021-11-30')
ON DUPLICATE KEY UPDATE
    license_id = VALUES(license_id),
    release_date = VALUES(release_date);

INSERT INTO VULNERABILITY (vulnerability_id, cve_id, severity, published_date)
VALUES
    ('00000000-0000-4000-8000-000000000031', 'CVE-2022-24999', 'HIGH', '2022-02-17'),
    ('00000000-0000-4000-8000-000000000032', 'CVE-2021-23337', 'HIGH', '2021-02-15')
ON DUPLICATE KEY UPDATE
    severity = VALUES(severity),
    published_date = VALUES(published_date);

INSERT INTO COMPONENT_VERSION_VULNERABILITY (
    component_version_id,
    vulnerability_id,
    remediation_status,
    identified_date
)
VALUES
    ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000031', 'open', '2022-02-18'),
    ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000032', 'open', '2021-02-16')
ON DUPLICATE KEY UPDATE
    identified_date = VALUES(identified_date);

INSERT INTO APPLICATION (application_id, application_name, description)
VALUES (
    '00000000-0000-4000-8000-000000000041',
    'SBOM Sentinel Demo',
    'Local sample application for database exercises.'
)
ON DUPLICATE KEY UPDATE
    application_name = VALUES(application_name),
    description = VALUES(description);

INSERT INTO SBOM (sbom_id, application_id, format)
VALUES (
    '00000000-0000-4000-8000-000000000042',
    '00000000-0000-4000-8000-000000000041',
    'CycloneDX'
)
ON DUPLICATE KEY UPDATE
    format = VALUES(format);

INSERT INTO SBOM_CONTAINS (sbom_id, component_version_id)
VALUES
    ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000021'),
    ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000022'),
    ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000024')
ON DUPLICATE KEY UPDATE
    component_version_id = VALUES(component_version_id);

INSERT INTO DEPENDENCY (
    component_version_id,
    depends_on_component_version_id,
    dependency_scope
)
VALUES (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000024',
    'production'
)
ON DUPLICATE KEY UPDATE
    dependency_scope = VALUES(dependency_scope);
