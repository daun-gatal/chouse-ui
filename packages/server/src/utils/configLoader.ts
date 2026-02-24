import fs from "fs";
import yaml from "yaml";

/**
 * Recursively flattens a nested object into a single-level object with keys joined by underscores.
 * All keys are converted to uppercase to match standard environment variable conventions.
 * 
 * Example:
 * { rbac: { db_type: 'sqlite' } } -> { RBAC_DB_TYPE: 'sqlite' }
 */
export function flattenConfig(obj: Record<string, any>, prefix = ""): Record<string, string> {
    let result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
        // Convert key to uppercase for env var standard
        const newPrefix = prefix ? `${prefix}_${key.toUpperCase()}` : key.toUpperCase();

        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            // Recursively flatten nested objects
            const flatObj = flattenConfig(value, newPrefix);
            result = { ...result, ...flatObj };
        } else {
            // Convert arrays and other primitives to strings
            result[newPrefix] = String(value);
        }
    }

    return result;
}

/**
 * Loads configuration from a YAML file specified by CHOUSE_CONFIG_PATH
 * and injects the flattened keys into process.env.
 * 
 * This module should execute before other application logic to ensure
 * environment variables are properly overridden.
 */
function loadConfig() {
    const configPath = process.env.CHOUSE_CONFIG_PATH;
    if (!configPath) {
        return; // No config file specified, continue with default env vars
    }

    try {
        if (!fs.existsSync(configPath)) {
            console.error(`❌ Configuration file not found at ${configPath}.`);
            process.exit(1);
        }

        const fileContents = fs.readFileSync(configPath, "utf8");
        const parsedConfig = yaml.parse(fileContents);

        if (parsedConfig && typeof parsedConfig === "object") {
            const flattened = flattenConfig(parsedConfig);

            // Override process.env with the flattened YAML config
            for (const [key, value] of Object.entries(flattened)) {
                process.env[key] = value;
            }

            console.log(`✅ Loaded configuration from ${configPath}`);
        } else {
            console.error(`❌ Invalid configuration format in ${configPath}. Expected a YAML object.`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`❌ Failed to load configuration from ${configPath}:`, error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Execute immediately when imported
loadConfig();
