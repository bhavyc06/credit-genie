import express from "express";
import { Request, Response, NextFunction } from 'express';
import jwt from "jsonwebtoken"; // Import jsonwebtoken for JWT handling
import bodyParser from "body-parser"; // To parse JSON bodies

import cors from "cors";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { GoogleVertexAIEmbeddings } from "@langchain/community/embeddings/googlevertexai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { config } from "./config.js";
import { connectToDatabase, collections } from "./database.js";

const app = express();
app.use(cors());

const router = express.Router();
router.use(express.json());

const JWT_SECRET = "savesagechatbot"; // In production, store this securely!

// Define hardcoded user credentials
const HARD_CODED_USER = {
  username: "admin",
  password: "chatbotv3testing", // In production, use hashed passwords!
};

// Middleware to verify JWT
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Get the token from the Authorization header
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Expecting 'Bearer TOKEN'

  if (!token) {
    return res.status(401).json({ error: "Access token is missing or invalid" });
  }

  // Verify the token
  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Token is not valid" });
    }
    // Optionally attach user information to the request
    (req as any).user = user;
    next();
  });
}

// Login route to authenticate the user and issue a JWT
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  // Validate request
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  // Check against hardcoded credentials
  if (
    username === HARD_CODED_USER.username &&
    password === HARD_CODED_USER.password
  ) {
    // User authenticated, create a JWT
    const payload = { username: HARD_CODED_USER.username };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" }); // Token valid for x hour

    return res.json({ token });
  } else {
    // Authentication failed
    return res.status(401).json({ error: "Invalid username or password" });
  }
});



router.get("/" , async (_, res) => {
  res.send("Welcome to the SaveSage Chatbot API! 🤖");
});

// Initialize the conversational Vertex AI model
const model = new ChatVertexAI({
  model: "gemini-1.5-pro-001",
  maxOutputTokens: 2048,
  temperature: 0.1,
  topP: 0.2,
  topK: 20,
});

// Connect to the MongoDB Atlas database
await connectToDatabase();

// Initialize a single MongoDB Atlas Vector Search
const vectorStore = new MongoDBAtlasVectorSearch(
  new GoogleVertexAIEmbeddings(), // Or your preferred embedding model
  {
    collection: collections.context as any,
    indexName: "credit-card-info", // Your single index name
    textKey: "text",
    embeddingKey: "embedding",
  }
);

// In-memory conversation history
const conversationHistory: { role: string; content: any }[] = [];

router.post("/messages" , authenticateToken ,async (req, res) => {
  let message = req.body.text;
  if (!message) {
    return res.status(400).send({ error: "Message is required" });
  }

  try {
    // 1. Keyword Search with MongoDB Atlas
    const keywordResults = await collections.context.aggregate([
      {
        $search: {
          index: "credit-card-info",
          text: {
            query: message,
            path: "text",
          },
        },
      },
      {
        $project: {
          _id: 0,
          pageContent: "$text",
          keywordScore: { $meta: "searchScore" },
        },
      },
    ]).toArray();

    // 2. Semantic Search with MongoDB Atlas Vector Search + Scores
    //    Must embed the string to get a numeric array
    const embeddings = new GoogleVertexAIEmbeddings();
    const queryEmbedding = await embeddings.embedQuery(message);

    const semanticResultsWithScores = await vectorStore.similaritySearchVectorWithScore(
      queryEmbedding,
      5
    );

    // Transform vector results
    const semanticResults = semanticResultsWithScores.map(([doc, score]) => {
      return {
        pageContent: doc.pageContent,
        vectorScore: score,
      };
    });

    // 3. Combine and Re-rank results
    const combinedResults = [...keywordResults, ...semanticResults];
    const rankedResults = rerankResults(combinedResults);

    // 4. Build the context from the top-ranked results
    let context = "";
    if (rankedResults.length > 0) {
      context = rankedResults.map((doc) => doc.pageContent).join("\n\n");
    }

    // 5. Build conversation history string
    const historyString = conversationHistory
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n");

    // 6. Construct prompt
    const prompt = `
You are a helpful assistant specializing exclusively in credit card information. 
You should only answer questions related to credit cards. 
If the question is not about credit cards, respond with: "I'm sorry, but I do not have enough information to answer that."

Conversation so far:
${historyString}

User question: ${message}

Context:
${context}
`;

    // 7. Invoke the Vertex AI model
    const modelResponse = await model.invoke(prompt);
    const textResponse = modelResponse.text;

    // 8. Update conversation history
    conversationHistory.push({ role: "user", content: message });
    conversationHistory.push({ role: "assistant", content: textResponse });

    return res.send({ text: textResponse });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: "Model invocation failed." });
  }
});

// Weighted Fusion re-rank
function rerankResults(results: any[]) {
  const ALPHA = 0.7; // 70% weight to keyword, 30% to vector

  // Compute combinedScore
  for (const doc of results) {
    const kwScore = doc.keywordScore ?? 0;
    const vecScore = doc.vectorScore ?? 0;
    doc.combinedScore = ALPHA * kwScore + (1 - ALPHA) * vecScore;
  }

  // Sort by descending combinedScore
  results.sort((a, b) => b.combinedScore - a.combinedScore);

  // Remove duplicates by pageContent, preserving the highest-ranked
  const seen = new Set();
  const finalRanked = [];
  for (const doc of results) {
    if (!seen.has(doc.pageContent)) {
      finalRanked.push(doc);
      seen.add(doc.pageContent);
    }
  }

  return finalRanked;
}

app.use(router);

// Start the Express server
app.listen(config.server.port, () => {
  console.log(`Server running on port:${config.server.port}...`);
});
