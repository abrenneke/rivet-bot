import { initializeDatabase } from '../src/config.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as Rivet from '@ironclad/rivet-node';
import { config } from 'dotenv';
import { isDocEmbedded, storeDoc, storeDocEmbedding } from '../src/queries.js';
import PQueue from 'p-queue';
import cliProgress from 'cli-progress';

config();

const CONCURRENT_TASKS = 20; // Adjust this based on your system's capabilities
const queue = new PQueue({ concurrency: CONCURRENT_TASKS });
const progressBar = new cliProgress.SingleBar(
  {
    format: 'Processing documents |{bar}| {percentage}% | {value}/{total} files | ETA: {eta}s | Speed: {speed} files/s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  },
  cliProgress.Presets.shades_classic,
);

const db = await initializeDatabase();

async function findAllDocsFiles(rootDir: string) {
  const walk = async (dir: string, acc: string[] = []) => {
    const files = await readdir(dir);
    for (const file of files) {
      const path = join(dir, file);
      const stats = await stat(path);
      if (stats.isDirectory()) {
        await walk(path, acc);
      } else {
        acc.push(path);
      }
    }
    return acc;
  };

  const allDocsFiles = await walk(rootDir);
  return allDocsFiles;
}

async function processFile(file: string): Promise<void> {
  try {
    const fullPath = `/usr/local/repos/rivet/packages/docs/docs/${file}`;
    const body = await readFile(fullPath, 'utf-8');

    await storeDoc(db, file, file, body);

    if (await isDocEmbedded(db, file)) {
      progressBar.increment();
      return;
    }

    const { output: embeddingValue } = await Rivet.runGraphInFile('./bot.rivet-project', {
      graph: 'Embed Doc',
      inputs: {
        doc: {
          type: 'string',
          value: body,
        },
        file_path: {
          type: 'string',
          value: file,
        },
      },
    });

    const vector = Rivet.coerceType(embeddingValue, 'vector');
    await storeDocEmbedding(db, file, vector);
    progressBar.increment();
  } catch (error) {
    console.error(`Error processing file ${file}:`, error);
    progressBar.increment(); // Still increment even on error to maintain accurate progress
  }
}

async function main() {
  try {
    console.log('Finding markdown files...');
    const allDocsFiles = await findAllDocsFiles('/usr/local/repos/rivet/packages/docs/docs');
    const filteredDocsFiles = allDocsFiles.filter((file) => file.endsWith('.md') || file.endsWith('.mdx'));
    const docsRelativePaths = filteredDocsFiles.map((file) =>
      file.replace('/usr/local/repos/rivet/packages/docs/docs/', ''),
    );

    console.log(`Found ${docsRelativePaths.length} markdown files to process`);
    progressBar.start(docsRelativePaths.length, 0, {
      speed: 'N/A',
    });

    // Add all files to the queue
    const promises = docsRelativePaths.map((file) => queue.add(() => processFile(file)));

    // Wait for all files to be processed
    await Promise.all(promises);

    progressBar.stop();
    console.log('\nAll documents processed successfully!');
  } catch (error) {
    progressBar.stop();
    console.error('An error occurred during processing:', error);
    process.exit(1);
  } finally {
    await db.close(); // Clean up database connection
  }
}

main().catch(console.error);
