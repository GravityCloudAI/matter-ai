// make api call to Gravity notifying the change

export const syncer = async (integration: string, syncData: any) => {
    const gravityUrl = process.env.GRAVITY_API_URL
    const gravityToken = process.env.GRAVITY_API_KEY

    if (!gravityUrl || !gravityToken) {
        console.error("Missing Gravity URL or API key")
        return
    }

    try {
        const response = await fetch(gravityUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${gravityToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'sync_notification',
                integration,
                syncData
            })
        })

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()
        console.log("Successfully notified Gravity of sync:", data)
    } catch (error) {
        console.error("Error notifying Gravity:", error)
    }
}