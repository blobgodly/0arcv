import { Pool } from 'pg';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { customType, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { GoogleGenAI } from '@google/genai';

const VECTOR_DIMENSIONS = 768;
const OWNER_SCOPE = '0arc-owner';

const vectorColumn = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${VECTOR_DIMENSIONS})`,
  toDriver: (values) => `[${values.join(',')}]`,
  fromDriver: (value) => value.slice(1, -1).split(',').map(Number),
});

const archiveVectors = pgTable('archive_ai_vectors', {
  userId: text('user_id').notNull(),
  recordId: text('record_id').notNull(),
  category: text('category').notNull(),
  content: text('content').notNull(),
  embedding: vectorColumn('embedding').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.category, table.recordId] })]);

export interface ArchiveVectorRecord {
  id: string;
  category: 'tool' | 'note' | 'watchlist';
  content: string;
}

export interface ArchiveMatch {
  category: ArchiveVectorRecord['category'];
  recordId: string;
  content: string;
  similarity: number;
}

let pool: Pool | undefined;
let db: ReturnType<typeof drizzle> | undefined;

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('Neon DATABASE_URL is not configured.');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, query_timeout: 12_000, statement_timeout: 12_000 });
  if (!db) db = drizzle(pool);
  return db;
}

export async function searchArchiveVectors(
  ai: GoogleGenAI,
  query: string,
  records: ArchiveVectorRecord[],
): Promise<ArchiveMatch[]> {
  const database = getDb();
  const existingRows = await database
    .select({ recordId: archiveVectors.recordId, category: archiveVectors.category, content: archiveVectors.content })
    .from(archiveVectors)
    .where(eq(archiveVectors.userId, OWNER_SCOPE));
  const existing = new Map(existingRows.map((row) => [`${row.category}:${row.recordId}`, row.content]));
  const currentIds = new Map<string, string[]>();
  for (const record of records) {
    const ids = currentIds.get(record.category) || [];
    ids.push(record.id);
    currentIds.set(record.category, ids);
  }

  const changedRecords = records.filter((record) => existing.get(`${record.category}:${record.id}`) !== record.content);
  if (changedRecords.length) {
    const embedded = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: changedRecords.map((record) => record.content),
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: VECTOR_DIMENSIONS, httpOptions: { timeout: 15_000 } },
    });
    const vectors = embedded.embeddings?.map((embedding) => embedding.values || []) || [];
    if (vectors.length !== changedRecords.length || vectors.some((vector) => vector.length !== VECTOR_DIMENSIONS)) {
      throw new Error('Gemini returned an unexpected embedding shape.');
    }

    await database.insert(archiveVectors).values(changedRecords.map((record, index) => ({
      userId: OWNER_SCOPE,
      recordId: record.id,
      category: record.category,
      content: record.content,
      embedding: vectors[index],
      updatedAt: new Date(),
    }))).onConflictDoUpdate({
      target: [archiveVectors.userId, archiveVectors.category, archiveVectors.recordId],
      set: {
        content: sql`excluded.content`,
        embedding: sql`excluded.embedding`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  }

  for (const category of ['tool', 'note', 'watchlist'] as const) {
    const where = [eq(archiveVectors.userId, OWNER_SCOPE), eq(archiveVectors.category, category)];
    const ids = currentIds.get(category) || [];
    await database.delete(archiveVectors).where(ids.length
      ? and(...where, notInArray(archiveVectors.recordId, ids))
      : and(...where));
  }

  const queryEmbedding = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: query,
    config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: VECTOR_DIMENSIONS, httpOptions: { timeout: 15_000 } },
  });
  const values = queryEmbedding.embeddings?.[0]?.values;
  if (!values || values.length !== VECTOR_DIMENSIONS) throw new Error('Gemini did not return a query embedding.');
  const vectorLiteral = `[${values.join(',')}]`;
  const distance = sql<number>`${archiveVectors.embedding} <=> ${vectorLiteral}::vector`;
  const similarity = sql<number>`1 - (${archiveVectors.embedding} <=> ${vectorLiteral}::vector)`;
  const matches = await database
    .select({
      category: archiveVectors.category,
      recordId: archiveVectors.recordId,
      content: archiveVectors.content,
      similarity,
    })
    .from(archiveVectors)
    .where(eq(archiveVectors.userId, OWNER_SCOPE))
    .orderBy(asc(distance))
    .limit(10);

  return matches.map((match) => ({
    ...match,
    category: match.category as ArchiveVectorRecord['category'],
    similarity: Number(match.similarity),
  }));
}

