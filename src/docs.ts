import sql, { join } from 'sql-template-tag';
import type { Database } from 'sqlite';

export async function knnDocsEmbeddings(
  db: Database,
  query: {
    embedding: Float32Array;
    rephrased: string;
  },
  k: number,
): Promise<{ docId: string; distance: number }[]> {
  const result = await db.all(sql`
    SELECT doc_id, distance
    FROM vec_docs_embeddings
    WHERE embedding MATCH ${query.embedding}
    LIMIT ${k}
  `);

  return result.map((row) => ({
    docId: row.doc_id,
    distance: row.distance,
  }));
}

export async function getManyDocs(
  db: Database,
  docIds: string[],
): Promise<{ docId: string; body: string; fileName: string }[]> {
  const result = await db.all(sql`
    SELECT id as docId, body, file_name as fileName
    FROM docs
    WHERE id IN (${join(docIds)})
  `);

  return result.map((row) => ({
    docId: row.docId,
    body: row.body,
    fileName: row.fileName,
  }));
}
