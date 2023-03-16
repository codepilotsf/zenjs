// deno-lint-ignore-file no-explicit-any

// Note: considered this one too: https://docs.superstructjs.org

import { ObjectId } from "./deps.ts";
import { getDb, logger, validator } from "./mod.ts";

const db = await getDb();

export function model(options: any) {
  // By default, set $$strict to "remove" to disallow props not in schema.
  if (!options.schema["$$strict"]) options.schema.$$strict = "remove";
  const defaultPropsAndMethods = getDefaultPropsAndMethods(options);
  checkForConflicts(options, defaultPropsAndMethods);
  return { ...defaultPropsAndMethods };
}

// Todo: Add ability to define custom methods on models.

function getDefaultPropsAndMethods(options) {
  const collection = db.collection(options.collection);
  const checkValidation = validator.compile(options.schema);

  return {
    schema: options.schema,

    // create(): Insert a single document into the collection.
    async create(doc: any) {
      try {
        const invalid = await this.validateAll(doc);
        if (invalid) {
          logger.error(invalid);
          return invalid;
        }
        const _id = await collection.insertOne(doc);
        const newDoc = { _id, ...doc };
        return [newDoc, null];
      } catch (error) {
        logger.error(error);
        return [{}, null];
      }
    },

    // TODO: Test this
    // // createAll(): Insert multiple documents into the collection.
    // async createAll(docs: any[]) {
    //   try {
    //     const res = await collection.insertMany(docs);
    //     return res.insertedIds; // TODO: return docs with _id?
    //   } catch (error) {
    //     logger.error(error);
    //   }
    // },

    // read(): Get a single document in the collection matching _id string or query.
    async read(query: any) {
      query = convertIdToObjectId(query);
      try {
        return await collection.findOne(query);
      } catch (error) {
        logger.error(error);
      }
    },

    // readAll(): List all documents in the collection matching the optional query.
    async readAll(query?: any) {
      try {
        return await collection.find(query || {}).toArray() || [];
      } catch (error) {
        logger.error(error);
        return [];
      }
    },

    // update(): Update a single document in the collection matching _id string or query.
    async update(query, update) {
      query = convertIdToObjectId(query);
      if (!query) return null;

      // The update object must not contain the immutable _id field.
      if (Object.keys(update).includes("_id")) delete update._id;
      try {
        const invalid = await this.validatePartial(update);
        if (invalid) return invalid;
        const res = await collection.findAndModify(
          query,
          { update: { $set: update }, new: true },
        );
        return res || null;
      } catch (error) {
        logger.error(error);
        return null;
      }
    },

    // TODO: Finish this
    // // updateAll(): Update multiple documents in the collection matching the query.
    // async updateAll(query, updates) {
    //   // TODO
    // },

    // delete(): Delete a single document in the collection matching _id string or query.
    async delete(query: any) {
      query = convertIdToObjectId(query);
      try {
        const res = await collection.findAndModify(
          query,
          { remove: true },
        );
        return res || null;
      } catch (error) {
        logger.error(error);
        return null;
      }
    },

    // TODO: Test this
    // // deleteAll(): Delete multiple documents in the collection matching the query.
    // async deleteAll(query: any) {
    //   try {
    //     const res = await collection.findAndModify(
    //       query,
    //       { remove: true, multi: true },
    //     );
    //     return res || null;
    //   } catch (error) {
    //     logger.error(error);
    //     return null;
    //   }
    // },

    // count(): Count the number of documents in the collection matching the query.
    async count(query: any) {
      query = convertIdToObjectId(query);
      try {
        return await collection.count(query) || 0;
      } catch (error) {
        logger.error(error);
        return 0;
      }
    },

    // exists(): Check if a document exists in the collection matching the query.
    async exists(query: any) {
      query = convertIdToObjectId(query);
      try {
        return await collection.count(query) > 0;
      } catch (error) {
        logger.error(error);
        return false;
      }
    },

    // validate(): Validate a single field against the schema.
    async validate(invalid, nameAndValue) {
      if (!nameAndValue) return invalid;
      const { name, value } = nameAndValue;
      invalid = invalid || {}; // Start with invalid as an object (not null).
      const invalidDoc = await this.validateAll({ [name]: value });
      if (invalidDoc === null) return null;
      if (name in invalidDoc) {
        invalid[name] = invalidDoc[name];
      } else {
        delete invalid[name];
      }
      return Object.keys(invalid).length ? invalid : null;
    },

    unvalidate(invalid, name) {
      // Remove a field from the invalid object and return as null if empty.
      invalid = invalid || {};
      delete invalid[name];
      return Object.keys(invalid).length ? invalid : null;
    },

    // validateAll(): Validate a document against the schema.
    async validateAll(doc: any) {
      const invalid = {};
      const validationRes = await checkValidation(doc);
      if (validationRes === true) return null;
      validationRes.forEach((err) => {
        invalid[err.field] = err.message;
      });
      return Object.keys(invalid).length ? invalid : null;
    },

    // validatePartial(): Validate a partial document against the schema (ignore missing keys).
    async validatePartial(doc: any) {
      const copy = { ...doc }; // don't mutate the original document!
      const invalid = {};
      const fullInvalid = await this.validateAll(copy);
      if (fullInvalid === null) return null;
      Object.keys(fullInvalid).forEach((key) => {
        if (Object.keys(copy).includes(key)) {
          invalid[key] = fullInvalid[key];
        }
      });
      return Object.keys(invalid).length ? invalid : null;
    },
  };
}

function checkForConflicts(options, defaultPropsAndMethods) {
  for (const key in defaultPropsAndMethods) {
    if (options?.methods && options.methods[key]) {
      logger.error(
        `Model ${options.collection} cannot have a property or method named ${key}`,
      );
    }
  }
}

// =========================================
function convertIdToObjectId(query: any) {
  // Convert _id string to { _id: <objectid> }
  if (typeof query === "string") {
    return { _id: new ObjectId(query) };
  } // Or is this an actual ObjectId?
  else if (query instanceof ObjectId) {
    return { _id: query };
  } // Convert object with { _id: string } to { _id: <objectid> }
  else if (typeof query === "object") {
    if (query._id && typeof query._id === "string") {
      query._id = new ObjectId(query._id);
    }
  }
  return query;
}
