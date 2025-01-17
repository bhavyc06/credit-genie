import * as dotenv from "dotenv";
dotenv.config();

import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { GoogleVertexAIEmbeddings } from "@langchain/community/embeddings/googlevertexai";


import { connectToDatabase } from "./database.js";



// Load all PDFs within the specified directory
const directoryLoader = new DirectoryLoader("cards/", {
  ".pdf": (path: string) => {
    try {
      console.log(`Loading PDF: ${path}`);
      return new PDFLoader(path);
    } catch (error) {
      console.error(`Failed to load PDF: ${path}`, error);
      return null; // Skip problematic PDFs
    }
  },
});

const docs = await directoryLoader.load();
const validDocs = docs.filter((doc) => doc !== null);
console.log(`Loaded ${validDocs.length} valid PDFs from the specified local directory.`);

console.log("GOOGLE_APPLICATION_CREDENTIALS:", process.env.GOOGLE_APPLICATION_CREDENTIALS);
// console.log("GOOGLE_PROJECT_ID:", process.env.GOOGLE_PROJECT_ID);


console.log(`Loaded ${docs.length} PDFs from the specified local directory.`);
// Split the PDF documents into chunks using recursive character splitter
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 300,
});

const splitDocs = await textSplitter.splitDocuments(docs);
console.log(
  `Split into ${splitDocs.length} text chunks using recursive character splitting.`
);
// Connect to the MongoDB database
const collections = await connectToDatabase();

// Instantiates a new MongoDBAtlasVectorSearch object with the specified configuration
const vectorStore = new MongoDBAtlasVectorSearch(
  // Google Cloud Vertex AI's text embeddings model will be used for vectorizing the text chunks
  new GoogleVertexAIEmbeddings(),
  {
    collection: collections.context as any,
    // The name of the Atlas Vector Search index. You must create this in the Atlas UI.
    indexName: "credit-card-info",
    // The name of the collection field containing the raw content. Defaults to "text"
    textKey: "text",
    // The name of the collection field containing the embedded text. Defaults to "embedding"
    embeddingKey: "embedding",
  }
);

// Insert the text chunks to the MongoDB Atlas vector store
const result = await vectorStore.addDocuments(splitDocs);

console.log(
  `Imported ${result.length} documents into the MongoDB Atlas vector store.`
);

process.exit(0);

// This table gives us the information about name of lounges present in different airports and whether those lounges are accessible on coral card or not.

// So in the first column its showing city name where the aiport is located.

// In 2nd column it's showing whether the lounge access is for domestic flights or international
// the third column is showing the airport name
// while the 4th is showing on which terminal is the lounge present. If there's written main for a airport terminal then it means that there's only 1 airport present
// in 5th column its showing the name of lounge. here different airports can have similar name of lounges so we distinguish them on the basis of airports and terminals
// under coral column 'true' means that this lounge is accessible for this card and false means lounge access is not accessible for this(coral) card
// all the columns are connected to each other in the manner written above
