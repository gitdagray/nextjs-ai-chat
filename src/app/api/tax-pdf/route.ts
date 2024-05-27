import { NextRequest, NextResponse } from "next/server";
import { Message as VercelChatMessage, StreamingTextResponse, OpenAIStream } from "ai";

import { createClient } from "@supabase/supabase-js";
import { Readable } from 'stream';

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { Document } from "@langchain/core/documents";
import { RunnableSequence } from "@langchain/core/runnables";
import {
  BytesOutputParser,
  StringOutputParser,
} from "@langchain/core/output_parsers";

import OpenAI from 'openai';

export const runtime = "edge";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  });

const combineDocumentsFn = (docs: Document[]) => {
  const serializedDocs = docs.map((doc) => doc.content);
  return serializedDocs.join("\n\n");
};

const formatVercelMessages = (chatHistory: VercelChatMessage[]) => {
  const formattedDialogueTurns = chatHistory.map((message) => {
    if (message.role === "user") {
      return `Human: ${message.content}`;
    } else if (message.role === "assistant") {
      return `Assistant: ${message.content}`;
    } else {
      return `${message.role}: ${message.content}`;
    }
  });
  return formattedDialogueTurns.join("\n");
};

const CONDENSE_QUESTION_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

<chat_history>
  {chat_history}
</chat_history>

Follow Up Input: {question}
Standalone question:`;
const condenseQuestionPrompt = PromptTemplate.fromTemplate(
  CONDENSE_QUESTION_TEMPLATE,
);

const ANSWER_TEMPLATE = `You are an energetic talking puppy named Dana, and must answer all questions like a happy, talking dog would.
Use lots of puns!

Answer the question based only on the following context and chat history:
<context>
  {context}
</context>

<chat_history>
  {chat_history}
</chat_history>

Question: {question}
`;
const answerPrompt = PromptTemplate.fromTemplate(ANSWER_TEMPLATE);

// Function to generate embeddings for the input text
async function getEmbedding(content:string) {
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small', 
    input: content,
  });
  return embedding.data[0].embedding;
}

/**
 * This handler initializes and calls a retrieval chain. It composes the chain using
 * LangChain Expression Language. See the docs for more information:
 *
 * https://js.langchain.com/docs/guides/expression_language/cookbook#conversational-retrieval-chain
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages ?? [];
    const previousMessages = messages.slice(0, -1);
    const currentMessageContent = messages[messages.length - 1].content;

    console.log('Received messages:', messages);

    const model = new ChatOpenAI({
      modelName: "gpt-3.5-turbo-1106",
      temperature: 0.2,
    });

    const client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PRIVATE_KEY!,
    );

    console.log('Supabase client initialized');

    const vectorstore = new SupabaseVectorStore(new OpenAIEmbeddings(), {
      client,
      tableName: "documents",
      queryName: "match_documents",
    });

    console.log('Vector store initialized');

    /**
     * We use LangChain Expression Language to compose two chains.
     * To learn more, see the guide here:
     *
     * https://js.langchain.com/docs/guides/expression_language/cookbook
     *
     * You can also use the "createRetrievalChain" method with a
     * "historyAwareRetriever" to get something prebaked.
     */
    const standaloneQuestionChain = RunnableSequence.from([
      condenseQuestionPrompt,
      model,
      new StringOutputParser(),
    ]);

    let resolveWithDocuments: (value: Document[]) => void;
    const documentPromise = new Promise<Document[]>((resolve) => {
      resolveWithDocuments = resolve;
    });

    const retriever = vectorstore.asRetriever({
      k: 3, // Number of documents to retrieve
      filter: {}, // Adjust this as needed to apply any metadata filters
      callbacks: [
        {
          handleRetrieverEnd(documents) {
            console.log('Retrieved documents:', documents);
            resolveWithDocuments(documents);
          },
        },
      ]
    });

    const retrievalChain = retriever.pipe(combineDocumentsFn);

    const answerChain = RunnableSequence.from([
      {
        context: RunnableSequence.from([
          (input) => input.question,
          retrievalChain,
        ]),
        chat_history: (input) => input.chat_history,
        question: (input) => input.question,
      },
      answerPrompt,
      model,
    ]);

    const conversationalRetrievalQAChain = RunnableSequence.from([
      {
        question: standaloneQuestionChain,
        chat_history: (input) => input.chat_history,
      },
      answerChain,
      // new BytesOutputParser(),
    ]);

    const test = await conversationalRetrievalQAChain.invoke({
      question: currentMessageContent,
      chat_history: formatVercelMessages(previousMessages),
    });

    // console.log('test', test);

    // console.log('currentMessageContent',currentMessageContent)
    // const stream = await conversationalRetrievalQAChain.stream({
    //   question: currentMessageContent,
    //   chat_history: formatVercelMessages(previousMessages),
    // });

    const documents = await documentPromise;

    if (documents.length === 0) {
      // If no documents are found, return a default response
      return NextResponse.json({
        message: "Eu não tenho essa informação",
        headers: {
          "x-message-index": (previousMessages.length + 1).toString(),
        },
      });
    }

    const serializedSources = Buffer.from(
      JSON.stringify(
        documents.map((doc) => {
          return {
            content: doc.content,
            metadata: doc.metadata,
          };
        }),
      ),
    ).toString("base64");

    // let streamedResult = "";
    // for await (const chunk of stream) {
    //   streamedResult += chunk;
    //   console.log(streamedResult);
    // }

    // const testStream = new Readable({
    //   read() {
    //     this.push(test.content); // Push the content to the stream
    //     this.push(null);         // Signal that no more data is coming
    //   }
    // });

    const contentString = String(test.content);

    // Assuming test.content is your final string response
    const responseMessage = {
      content: contentString,
      role: 'assistant'
    };

    // Wrap in a standard JSON structure
    return new NextResponse(JSON.stringify({ messages: [responseMessage] }), {
      headers: {
        'Content-Type': 'application/json',
        "x-message-index": (previousMessages.length + 1).toString(),
      },
    });

    // console.log('Content string:', contentString);

    // const stream = new ReadableStream({
    //   start(controller) {
    //     // controller.enqueue(new TextEncoder().encode(contentString));  // Encode the string into a Uint8Array
    //     const dataWithDelimiter = contentString + "\n";
    //     controller.enqueue(dataWithDelimiter);  
    //     controller.close();  // Close the stream after enqueueing
    //   }
    // });

    // return new StreamingTextResponse(stream, {
    //   headers: {
    //     "x-message-index": (previousMessages.length + 1).toString(),
    //     "x-sources": serializedSources,
    //   },
    // });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}