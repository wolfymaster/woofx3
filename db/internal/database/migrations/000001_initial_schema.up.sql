-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    platform VARCHAR(20),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100),
    application_id UUID NOT NULL,
    client_id UUID NOT NULL UNIQUE,
    client_secret VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Create user_applications join table
CREATE TABLE IF NOT EXISTS user_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id INTEGER NOT NULL,
    application_id UUID NOT NULL,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    CONSTRAINT uq_user_application UNIQUE (user_id, application_id)
);

-- Create user_events table
CREATE TABLE IF NOT EXISTS user_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    application_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_value JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Create user_meta table
CREATE TABLE IF NOT EXISTS user_meta (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id INTEGER NOT NULL,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL,
    value TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    application_id UUID NOT NULL,
    user_id UUID,
    key VARCHAR(100) NOT NULL,
    value TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    CONSTRAINT uq_setting UNIQUE (application_id, key)
);

-- Create commands table
CREATE TABLE IF NOT EXISTS commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL,
    command VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL,
    type_value TEXT,
    cooldown INTEGER DEFAULT 0,
    created_by UUID NOT NULL,
    priority INTEGER DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Create workflow_definitions table
CREATE TABLE IF NOT EXISTS workflow_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Create workflow_executions table
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_definition_id UUID NOT NULL,
    application_id UUID NOT NULL,
    user_id INTEGER,
    status VARCHAR(20) NOT NULL,
    input JSONB,
    output JSONB,
    error TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflow_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create treats table
CREATE TABLE IF NOT EXISTS treats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL,
    user_id INTEGER NOT NULL,
    treat_type VARCHAR(50) NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    application_id UUID NOT NULL,
    ptype VARCHAR(100) NOT NULL,
    v0 VARCHAR(100),
    v1 VARCHAR(100),
    v2 VARCHAR(100),
    v3 VARCHAR(100),
    v4 VARCHAR(100),
    v5 VARCHAR(100),
    
    -- Foreign key constraint
    CONSTRAINT fk_permissions_application_id 
        FOREIGN KEY (application_id) 
        REFERENCES applications(id) 
        ON UPDATE CASCADE 
        ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_broadcaster_id ON users(broadcaster_id);
CREATE INDEX IF NOT EXISTS idx_clients_application_id ON clients(application_id);
CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id);
CREATE INDEX IF NOT EXISTS idx_user_applications_user_id ON user_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_applications_application_id ON user_applications(application_id);
CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_application_id ON user_events(application_id);
CREATE INDEX IF NOT EXISTS idx_user_meta_user_id ON user_meta(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_application_id ON settings(application_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commands_application_id ON commands(application_id);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_application_id ON workflow_definitions(application_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_definition_id ON workflow_executions(workflow_definition_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_application_id ON workflow_executions(application_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id ON workflow_executions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_treats_application_id ON treats(application_id);
CREATE INDEX IF NOT EXISTS idx_treats_user_id ON treats(user_id);
CREATE INDEX IF NOT EXISTS idx_treats_created_at ON treats(created_at);
CREATE INDEX IF NOT EXISTS idx_permission_application_id ON permissions(application_id);
CREATE INDEX IF NOT EXISTS idx_permission_ptype ON permissions(ptype);
CREATE INDEX IF NOT EXISTS idx_permission_v0 ON permissions(v0);
CREATE INDEX IF NOT EXISTS idx_permission_v1 ON permissions(v1);
CREATE INDEX IF NOT EXISTS idx_permission_v2 ON permissions(v2);