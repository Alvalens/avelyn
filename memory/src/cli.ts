import {
  openMemoryStore,
  addCoreMemory,
  updateCoreMemory,
  deleteCoreMemory,
  listCoreMemory,
  searchCoreMemory,
  addRecallMemory,
  searchRecallMemory,
  type CoreCategory,
  type RecallCategory,
} from './memoryStore.ts';
import { DB_PATH } from './paths.ts';

const [, , command, ...args] = process.argv;

function usage(): never {
  console.log(`Usage:
  add-core <category> <content> [subject]     category: identity|preference|relationship|project|fact
  update-core <id> <content>
  delete-core <id>
  list-core [category]
  search-core <query>
  add-recall <category> <content> [occurredAt]   category: episode|conversation
  search-recall <query>`);
  process.exit(1);
}

function main() {
  if (!command) usage();

  const db = openMemoryStore(DB_PATH);

  switch (command) {
    case 'add-core': {
      const [category, content, subject] = args;
      if (!category || !content) usage();
      console.log(
        JSON.stringify(addCoreMemory(db, { category: category as CoreCategory, content, subject }), null, 2),
      );
      break;
    }
    case 'update-core': {
      const [id, content] = args;
      if (!id || !content) usage();
      updateCoreMemory(db, Number(id), { content });
      console.log(`Updated core memory ${id}.`);
      break;
    }
    case 'delete-core': {
      const [id] = args;
      if (!id) usage();
      deleteCoreMemory(db, Number(id));
      console.log(`Deleted core memory ${id}.`);
      break;
    }
    case 'list-core': {
      const [category] = args;
      console.log(JSON.stringify(listCoreMemory(db, category as CoreCategory | undefined), null, 2));
      break;
    }
    case 'search-core': {
      const [query] = args;
      if (!query) usage();
      console.log(JSON.stringify(searchCoreMemory(db, query), null, 2));
      break;
    }
    case 'add-recall': {
      const [category, content, occurredAt] = args;
      if (!category || !content) usage();
      console.log(
        JSON.stringify(addRecallMemory(db, { category: category as RecallCategory, content, occurredAt }), null, 2),
      );
      break;
    }
    case 'search-recall': {
      const [query] = args;
      if (!query) usage();
      console.log(JSON.stringify(searchRecallMemory(db, query), null, 2));
      break;
    }
    default:
      usage();
  }

  db.close();
}

main();
