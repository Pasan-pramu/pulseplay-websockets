import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { commentary } from '../db/schema.js';
import { listCommentaryQuerySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';

export const commentaryRouter = Router({ mergeParams: true });

const MAX_LIMIT = 100;

commentaryRouter.get('/', async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return res.status(400).json({ error: 'Invalid params', details: JSON.stringify(paramsParsed.error) });
    }

    const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
        return res.status(400).json({ error: 'Invalid query parameters', details: JSON.stringify(queryParsed.error) });
    }

    const limit = Math.min(queryParsed.data.limit ?? 100, MAX_LIMIT);

    try {
        const data = await db
            .select()
            .from(commentary)
            .where(eq(commentary.matchId, paramsParsed.data.id))
            .orderBy(desc(commentary.createdAt))
            .limit(limit);

        return res.json({ data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to fetch commentary' });
    }
});

