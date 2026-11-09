SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS APPLICATION (
    application_id CHAR(36) NOT NULL,
    application_name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS LICENSE (
    license_id CHAR(36) NOT NULL,
    license_name VARCHAR(255) NOT NULL,
    spdx_identifier VARCHAR(100) NOT NULL,
    license_type VARCHAR(50) NULL,
    PRIMARY KEY (license_id),
    CONSTRAINT uq_license_spdx
        UNIQUE (spdx_identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS COMPONENT (
    component_id CHAR(36) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    component_type VARCHAR(100) NULL,
    PRIMARY KEY (component_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SBOM (
    sbom_id CHAR(36) NOT NULL,
    application_id CHAR(36) NOT NULL,
    format VARCHAR(50) NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sbom_id),
    CONSTRAINT fk_sbom_application
        FOREIGN KEY (application_id)
        REFERENCES APPLICATION(application_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS COMPONENT_VERSION (
    component_version_id CHAR(36) NOT NULL,
    component_id CHAR(36) NOT NULL,
    license_id CHAR(36) NULL,
    version_number VARCHAR(100) NOT NULL,
    release_date DATE NULL,
    PRIMARY KEY (component_version_id),
    CONSTRAINT fk_cv_component
        FOREIGN KEY (component_id)
        REFERENCES COMPONENT(component_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cv_license
        FOREIGN KEY (license_id)
        REFERENCES LICENSE(license_id)
        ON DELETE SET NULL,
    CONSTRAINT uq_component_version
        UNIQUE (component_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS COMPONENT_VERSION_LICENSE (
    component_version_id CHAR(36) NOT NULL,
    license_id CHAR(36) NOT NULL,
    PRIMARY KEY (component_version_id, license_id),
    CONSTRAINT fk_cvl_component_version
        FOREIGN KEY (component_version_id)
        REFERENCES COMPONENT_VERSION(component_version_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cvl_license
        FOREIGN KEY (license_id)
        REFERENCES LICENSE(license_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS VULNERABILITY (
    vulnerability_id CHAR(36) NOT NULL,
    cve_id VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    published_date DATE NULL,
    PRIMARY KEY (vulnerability_id),
    CONSTRAINT uq_vulnerability_cve
        UNIQUE (cve_id),
    CONSTRAINT chk_severity
        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SBOM_CONTAINS (
    sbom_id CHAR(36) NOT NULL,
    component_version_id CHAR(36) NOT NULL,
    PRIMARY KEY (sbom_id, component_version_id),
    CONSTRAINT fk_sc_sbom
        FOREIGN KEY (sbom_id)
        REFERENCES SBOM(sbom_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_sc_component_version
        FOREIGN KEY (component_version_id)
        REFERENCES COMPONENT_VERSION(component_version_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS DEPENDENCY (
    component_version_id CHAR(36) NOT NULL,
    depends_on_component_version_id CHAR(36) NOT NULL,
    dependency_scope VARCHAR(50) NULL,
    PRIMARY KEY (
        component_version_id,
        depends_on_component_version_id
    ),
    CONSTRAINT fk_dep_component_version
        FOREIGN KEY (component_version_id)
        REFERENCES COMPONENT_VERSION(component_version_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_dep_depends_on
        FOREIGN KEY (depends_on_component_version_id)
        REFERENCES COMPONENT_VERSION(component_version_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_no_self_dependency
        CHECK (
            component_version_id <> depends_on_component_version_id
        )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS COMPONENT_VERSION_VULNERABILITY (
    component_version_id CHAR(36) NOT NULL,
    vulnerability_id CHAR(36) NOT NULL,
    remediation_status VARCHAR(50) NOT NULL DEFAULT 'open',
    identified_date DATE NULL,
    PRIMARY KEY (
        component_version_id,
        vulnerability_id
    ),
    CONSTRAINT fk_cvv_component_version
        FOREIGN KEY (component_version_id)
        REFERENCES COMPONENT_VERSION(component_version_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cvv_vulnerability
        FOREIGN KEY (vulnerability_id)
        REFERENCES VULNERABILITY(vulnerability_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_remediation_status
        CHECK (
            remediation_status IN (
                'open',
                'in_progress',
                'resolved',
                'wont_fix',
                'accepted_risk'
            )
        )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
