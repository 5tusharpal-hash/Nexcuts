import { logger } from '../../bootstrap/logger.js';
import { disconnectDb, connectDb } from '../../bootstrap/db.connect.js';
import { InventoryRepository } from './inventory.repository.js';

const repository = new InventoryRepository();

export async function runInventoryReminderJob() {
    const result = await repository.runDueReminders();
    logger.info(result, 'Inventory reminder job finished');
    return result;
}

async function runScheduledEntryPoint() {
    try {
        await connectDb();
        await runInventoryReminderJob();
    } finally {
        await disconnectDb();
    }
}

if (process.argv[1]?.endsWith('inventory-reminders.job.ts')) {
    void runScheduledEntryPoint().catch((error: unknown) => {
        logger.fatal({ error }, 'Inventory reminder job failed');
        process.exitCode = 1;
    });
}
