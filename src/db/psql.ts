import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

export const init = async () => {
    const client = await pool.connect()

    // create tables if not exist
    await client.query(`CREATE TABLE IF NOT EXISTS github_data (
        id SERIAL PRIMARY KEY,
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
        installation_id INT PRIMARY KEY,
        pull_requests JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`)

    client.release()
}

export const queryWParams = async (query: string, params: any[]) => {
    try {
        const client = await pool.connect()
        const result = await client.query(query, params)
        return result
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const query = async (query: string) => {
    try {
        const client = await pool.connect()
        const result = await client.query(query)
        return result
    } catch (error) {
        console.error(error)
        throw error
    }
}