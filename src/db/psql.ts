import * as dotenv from 'dotenv'
dotenv.config()
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT) : 5432
})

export const init = async () => {
    const client = await pool.connect()

    // create tables if not exist
    await client.query(`CREATE TABLE IF NOT EXISTS github_data (
        installation_id INT PRIMARY KEY,
        payload JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    await client.query(`CREATE TABLE IF NOT EXISTS github_repositories (
        installation_id INT PRIMARY KEY,
        repositories JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    await client.query(`CREATE TABLE IF NOT EXISTS github_branches (
        installation_id INT PRIMARY KEY,
        branches JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    await client.query(`CREATE TABLE IF NOT EXISTS github_users (
        installation_id INT PRIMARY KEY,
        users JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    await client.query(`CREATE TABLE IF NOT EXISTS github_pull_requests (
        installation_id INTEGER NOT NULL,
        repo VARCHAR(255) NOT NULL,
        pr_id INTEGER NOT NULL,
        pr_data JSONB NOT NULL,
        pr_status VARCHAR(50) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (installation_id, repo, pr_id)
    )`)

    await client.query(`CREATE TABLE IF NOT EXISTS llm_logs (
        id SERIAL PRIMARY KEY,
        installation_id INTEGER,
        repo TEXT,
        pr_id INTEGER,
        request JSONB,
        response JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    await client.query(`CREATE INDEX IF NOT EXISTS idx_github_pull_requests_installation_id ON github_pull_requests(installation_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_github_pull_requests_repo ON github_pull_requests(repo);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_github_pull_requests_updated_at ON github_pull_requests(updated_at);`)

    client.release()
}

const getClientConnection = async () => {
    try {
        console.log("[GET_CLIENT_CONNECTION] Getting client connection")
        const client = await pool.connect()
        return client
    } catch (error) {
        console.log("[GET_CLIENT_CONNECTION] Error getting client connection", error)
        throw error
    }
}

export const queryWParams = async (query: string, params: any[]) => {
    const client = await getClientConnection()
    try {
        const result = await client.query(query, params)
        return result
    } catch (error) {
        console.log("[QUERY_W_PARAMS] Error querying with params", error)
        throw error
    } finally {
        client.release()
    }
}

export const query = async (query: string) => {
    const client = await getClientConnection()
    try {
        const result = await client.query(query)
        return result
    } catch (error) {
        console.log("[QUERY] Error querying", error)
        throw error
    } finally {
        client.release()
    }
}