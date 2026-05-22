import  {Router} from 'express'
import {createMatchSchema, listMatchesQuerySchema} from "../validation/matches.js";
import {matches, commentary} from "../db/schema.js";
import {db} from "../db/db.js";
import {getMatchStatus} from "../utils/match-status.js";
import {desc} from "drizzle-orm";
import {createCommentarySchema} from "../validation/commentary.js";
import {matchIdParamSchema} from "../validation/matches.js";
import {commentaryRouter} from "./commentary.js";

export const  matchRouter = Router();

const MAX_LIMIT = 100;

matchRouter.get('/', async (req, res) => {
   const parsed =listMatchesQuerySchema.safeParse(req.query);

   if(!parsed.success){
         return res.status(400).json({error:'Invalid query parameters',details:JSON.stringify(parsed.error)});
   }

   const limit = Math.min(parsed.data.limit ?? 50 ,MAX_LIMIT);

   try{
       const data = await  db
           .select()
           .from(matches)
           .orderBy((desc(matches.createdAt)))
           .limit(limit)

       res.json({data:data});

   }catch(e){
         console.error(e);
         res.status(500).json({error:'Failed to fetch matches'});
   }

});

matchRouter.post('/', async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);
    const {data:{startTime,endTime,homeScore,awayScore}} =parsed;

    if(!parsed.success){
        return res.status(400).json({error:'Invalid payload',details:JSON.stringify(parsed.error)});
    }
    try{
        const [event] = await db.insert(matches).values({
            ...parsed.data,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            status: getMatchStatus(startTime,endTime),
        }).returning();

        res.status(201).json({message:'Match created successfully',match:event})

        if (res.app.locals.broadcastMatchCreated){
            try{
                res.app.locals.broadcastMatchCreated(event);
            }catch(e){
                console.error(e);
            }
        }

    }catch(e){
        console.error(e);
        res.status(500).json({error:'Failed to create match'});
    }
})

matchRouter.post('/:id/commentary', async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return res.status(400).json({ error: 'Invalid params', details: JSON.stringify(paramsParsed.error) });
    }

    const bodyParsed = createCommentarySchema.safeParse(req.body);
    if (!bodyParsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: JSON.stringify(bodyParsed.error) });
    }

    try {
        const [entry] = await db.insert(commentary).values({
            matchId: paramsParsed.data.id,
            ...bodyParsed.data,
        }).returning();

        if (req.app.locals.broadcastCommentaryAdded) {
            req.app.locals.broadcastCommentaryAdded(paramsParsed.data.id, entry);
        }

        return res.status(201).json({ message: 'Commentary created successfully', commentary: entry });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to create commentary' });
    }
});

matchRouter.use('/:id/commentary', commentaryRouter);
