-- Drop tables in reverse order of dependencies
DROP TABLE IF EXISTS treats CASCADE;
DROP TABLE IF EXISTS workflow_executions CASCADE;
DROP TABLE IF EXISTS workflow_definitions CASCADE;
DROP TABLE IF EXISTS commands CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS user_meta CASCADE;
DROP TABLE IF EXISTS user_events CASCADE;
DROP TABLE IF EXISTS user_applications CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop indexes
DROP INDEX IF EXISTS idx_users_user_id;
DROP INDEX IF EXISTS idx_users_broadcaster_id;
DROP INDEX IF EXISTS idx_clients_application_id;
DROP INDEX IF EXISTS idx_clients_client_id;
DROP INDEX IF EXISTS idx_user_applications_user_id;
DROP INDEX IF EXISTS idx_user_applications_application_id;
DROP INDEX IF EXISTS idx_user_events_user_id;
DROP INDEX IF EXISTS idx_user_events_application_id;
DROP INDEX IF EXISTS idx_user_meta_user_id;
DROP INDEX IF EXISTS idx_settings_application_id;
DROP INDEX IF EXISTS idx_settings_user_id;
DROP INDEX IF EXISTS idx_commands_application_id;
DROP INDEX IF EXISTS idx_workflow_definitions_application_id;
DROP INDEX IF EXISTS idx_workflow_executions_workflow_definition_id;
DROP INDEX IF EXISTS idx_workflow_executions_application_id;
DROP INDEX IF EXISTS idx_workflow_executions_user_id;
DROP INDEX IF EXISTS idx_treats_application_id;
DROP INDEX IF EXISTS idx_treats_user_id;
DROP INDEX IF EXISTS idx_treats_created_at;

-- Drop extensions
DROP EXTENSION IF EXISTS "uuid-ossp";
