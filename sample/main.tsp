import "../lib/main.tsp";

using JustTheSchema;

/** Identifies a pet across the store. */
@minValue(1)
scalar petId extends int64;

@zodType("z.email()")
scalar email extends string;

enum PetKind {
  Dog: "dog",
  Cat: "cat",
}

/** A pet in the store. */
model Pet {
  id: petId;
  @minLength(1) @maxLength(50) name: string;
  kind: PetKind;
  birthDate?: plainDate;
  registeredAt: utcDateTime;
  @minItems(1) tags: string[];
  attributes: Record<unknown>;
  homepage: "https://pets.example/${string}";
  ownerMail?: email;
}

model Dog extends Pet {
  kind: PetKind.Dog;
  goodBoy: true;
}

model Pets is Pet[];

/** A category in the pet taxonomy. */
model Category {
  name: string;
  parent?: Category;
}

union SearchResult {
  pets: Pets,
  message: string,
}
