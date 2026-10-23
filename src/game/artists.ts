/**
 * Curated artist list for the Six Degrees game.
 * These are recognizable names that serve as game start/end points.
 * Also the curated seeds of the graph build: scripts/process_mb_dump.py reads
 * the `mbid` of every entry here (keep one entry per line).
 * The game picks two of the same type (both persons or both groups).
 *
 * No supergroups — they emerge naturally from the graph.
 * No duplicates between persons and their bands (some overlap is fine for recognizability).
 */

export interface GameArtist {
  /** Display name, for reading this list; the MBID is what identifies the artist. */
  name: string;
  type: "person" | "group";
  /** MusicBrainz ID. Names can be ambiguous (several "Lemmy"s) or change ("Kanye West" is now "Ye"). */
  mbid: string;
}

export const GAME_ARTISTS: GameArtist[] = [
  // --- Modern Pop / Hip Hop / R&B ---
  { name: "Bruno Mars", type: "person", mbid: "afb680f2-b6eb-4cd7-a70b-a63b25c763d5" },
  { name: "The Weeknd", type: "person", mbid: "c8b03190-306c-4120-bb0b-6f2ebfc06ea9" },
  { name: "Rihanna", type: "person", mbid: "73e5e69d-3554-40d8-8516-00cb38737a1c" },
  { name: "Taylor Swift", type: "person", mbid: "20244d07-534f-4eff-b4d4-930878889970" },
  { name: "Lady Gaga", type: "person", mbid: "650e7db6-b795-4eb5-a702-5ea2fc46c848" },
  { name: "Ariana Grande", type: "person", mbid: "f4fdbb4c-e4b7-47a0-b83b-d91bbfcfa387" },
  { name: "Drake", type: "person", mbid: "9fff2f8a-21e6-47de-a2b8-7f449929d43f" },
  { name: "Billie Eilish", type: "person", mbid: "f4abc0b5-3f7a-4eff-8f78-ac078dbce533" },
  { name: "Kendrick Lamar", type: "person", mbid: "381086ea-f511-4aba-bdf9-71c753dc5077" },
  { name: "Post Malone", type: "person", mbid: "b1e26560-60e5-4236-bbdb-9aa5a8d5ee19" },
  { name: "Kanye West", type: "person", mbid: "164f0d73-1234-4e2c-8743-d77bf2191051" },
  { name: "Beyoncé", type: "person", mbid: "859d0860-d480-4efd-970c-c05d5f1776b8" },
  { name: "Frank Ocean", type: "person", mbid: "e520459c-dff4-491d-a6e4-c97be35e0044" },
  { name: "Tyler, the Creator", type: "person", mbid: "f6beac20-5dfe-4d1f-ae02-0b0a740aafd6" },
  { name: "Pharrell Williams", type: "person", mbid: "149f91ef-1287-46da-9a8e-87fee02f1471" },
  { name: "Jay-Z", type: "person", mbid: "f82bcf78-5b69-4622-a5ef-73800768d9ac" },
  { name: "Snoop Dogg", type: "person", mbid: "f90e8b26-9e52-4669-a5c9-e28529c47894" },
  { name: "Dr. Dre", type: "person", mbid: "5f6ab597-f57a-40da-be9e-adad48708203" },
  { name: "André 3000", type: "person", mbid: "f563a1a9-069b-41ed-8b3b-e1b1a6f5b34b" },
  { name: "Nas", type: "person", mbid: "cfbc0924-0035-4d6c-8197-f024653af823" },
  { name: "MF DOOM", type: "person", mbid: "188711ed-c99b-439c-844a-ca831f63a727" },
  { name: "Madlib", type: "person", mbid: "ea9078ef-20ca-4506-81ea-2ae5fe3a42e8" },
  { name: "RZA", type: "person", mbid: "29c28ac3-27c5-4822-8eb6-0af89a3a7240" },
  { name: "Q-Tip", type: "person", mbid: "b3c94036-6166-41d2-91a2-dc3a0b5fa188" },
  { name: "Lauryn Hill", type: "person", mbid: "b14191fa-24c5-44d8-b42d-5017b22b0430" },
  { name: "Missy Elliott", type: "person", mbid: "a0b8cb9e-7532-45fe-a74c-30e7c4009a39" },
  { name: "Justin Timberlake", type: "person", mbid: "596ffa74-3d08-44ef-b113-765d43d12738" },
  { name: "D'Angelo", type: "person", mbid: "b66771cc-45fa-4a32-b14f-5337d7223d7a" },
  { name: "Erykah Badu", type: "person", mbid: "321531fc-db73-4ffa-a959-61a61a2908c1" },
  { name: "Anderson .Paak", type: "person", mbid: "d02dd67e-f655-4600-bc47-f789f59e7367" },
  { name: "Thundercat", type: "person", mbid: "044fd265-79dd-43eb-afc4-8b20becf7e17" },
  { name: "Flying Lotus", type: "person", mbid: "fc7376fe-1a6f-4414-b4a7-83f50ed59c92" },

  // --- Classic Rock ---
  { name: "Jimmy Page", type: "person", mbid: "519774a4-3b18-4042-b8c0-927845a616c9" },
  { name: "Robert Plant", type: "person", mbid: "bd53f9a7-8be9-46b0-bf7d-1deea3cb57bc" },
  { name: "John Paul Jones", type: "person", mbid: "4490113a-3880-4f5b-a39b-105bfceaed04" },
  { name: "Mick Jagger", type: "person", mbid: "b5ffc3aa-b868-4b88-905f-d73d51dbe51c" },
  { name: "Keith Richards", type: "person", mbid: "f0ed72a3-ae8f-4cf7-b51d-2696a2330230" },
  { name: "David Bowie", type: "person", mbid: "5441c29d-3602-4898-b1a1-b77fa23b8e50" },
  { name: "Paul McCartney", type: "person", mbid: "ba550d0e-adac-4864-b88b-407cab5e76af" },
  { name: "George Harrison", type: "person", mbid: "42a8f507-8412-4611-854f-926571049fa0" },
  { name: "Eric Clapton", type: "person", mbid: "618b6900-0618-4f1e-b835-bccb17f84294" },
  { name: "Jimi Hendrix", type: "person", mbid: "06fb1c8b-566e-4cb2-985b-b467c90781d4" },
  { name: "Roger Waters", type: "person", mbid: "0f50beab-d77d-4f0f-ac26-0b87d3e9b11b" },
  { name: "David Gilmour", type: "person", mbid: "1dce970e-34bc-48b2-ab51-48d87544a4c2" },
  { name: "Freddie Mercury", type: "person", mbid: "022589ac-7177-460d-a178-9976cf70e29f" },
  { name: "Brian May", type: "person", mbid: "6d24f102-5c43-453a-8664-4ee092f441cf" },
  { name: "Pete Townshend", type: "person", mbid: "fb147b8f-0144-4418-acaa-90b2d9779840" },
  { name: "Neil Young", type: "person", mbid: "75167b8b-44e4-407b-9d35-effe87b223cf" },
  { name: "Stevie Nicks", type: "person", mbid: "b7f2cca2-72c6-41fb-ae33-53370fc62fe7" },
  { name: "Peter Gabriel", type: "person", mbid: "8e66ea2b-b57b-47d9-8df0-df4630aeb8e5" },
  { name: "Phil Collins", type: "person", mbid: "401c3991-b76b-499d-8082-9f2df958ef78" },

  // --- Punk / Post-Punk ---
  { name: "Iggy Pop", type: "person", mbid: "f37b3f31-b1f8-4b88-8cb5-b34f709b17d7" },
  { name: "Joe Strummer", type: "person", mbid: "af4ea2a3-c54d-40b4-8120-a1f0b838ad54" },
  { name: "Robert Smith", type: "person", mbid: "7d1a1624-784b-4f89-8ff9-b9b493cd059d" },
  { name: "David Byrne", type: "person", mbid: "d4659efb-b8eb-4f03-95e9-f69ce35967a9" },

  // --- Grunge / 90s Alt ---
  { name: "Dave Grohl", type: "person", mbid: "4d5f891d-9bce-45ae-ad86-912dd27252fa" },
  { name: "Chris Cornell", type: "person", mbid: "cbf9738d-8f81-4a92-bc64-ede09341652d" },
  { name: "Eddie Vedder", type: "person", mbid: "1a60d6dd-9d3e-40fc-a66d-3184f9ee0d61" },
  { name: "Billy Corgan", type: "person", mbid: "3cbfd3e3-6d9b-4327-84ba-42cf646c98f9" },
  { name: "Trent Reznor", type: "person", mbid: "bc880664-6751-4998-984d-ebdbff15d229" },
  { name: "Flea", type: "person", mbid: "2dc7a305-7a8c-4fcc-add4-5e9def0a9a0d" },
  { name: "John Frusciante", type: "person", mbid: "f1571db1-c672-4a54-a2cf-aaa329f26f0b" },
  { name: "Tom Morello", type: "person", mbid: "42a636a0-dbe4-4d0c-abe2-1590fad9531b" },

  // --- Indie / Alternative ---
  { name: "Thom Yorke", type: "person", mbid: "8ed2e0b3-aa4c-4e13-bec3-dc7393ed4d6b" },
  { name: "Jack White", type: "person", mbid: "3ae2fb37-8a23-429d-9920-bac811c4fc22" },
  { name: "Josh Homme", type: "person", mbid: "dbecd515-aac9-4e7b-808e-bca22809c316" },
  { name: "Alex Turner", type: "person", mbid: "ee953029-6de8-4c50-8d0f-215a1e4e8dd6" },
  { name: "Damon Albarn", type: "person", mbid: "7d7a5fdd-0d04-4c36-8bee-906feeae239c" },
  { name: "Noel Gallagher", type: "person", mbid: "6493ed80-8b44-49fa-91de-e7b0a0b57d6d" },
  { name: "Kevin Parker", type: "person", mbid: "b0ad6d5e-44f1-41a3-a452-1c378d350cb8" },
  { name: "Dan Auerbach", type: "person", mbid: "fa4f4b89-3ddc-4e97-88fa-0e30121f986a" },
  { name: "Julian Casablancas", type: "person", mbid: "c5ce487b-0462-444e-a184-4de0fef7e028" },
  { name: "St. Vincent", type: "person", mbid: "5334edc0-5faf-4ca5-b1df-000de3e1f752" },

  // --- Garage / Psych ---
  { name: "Ty Segall", type: "person", mbid: "07a17571-81fc-4cf8-a634-98f0d926d313" },
  { name: "John Dwyer", type: "person", mbid: "8d941959-2af3-447d-aa39-a215057ae7f5" },

  // --- Metal ---
  { name: "Tony Iommi", type: "person", mbid: "e5fa0175-2e93-4ca7-90c3-33f239381252" },
  { name: "Ozzy Osbourne", type: "person", mbid: "8aa5b65a-5b3c-4029-92bf-47a544356934" },
  { name: "James Hetfield", type: "person", mbid: "68c34082-c1d5-4399-af9b-3921ca0a6a1f" },
  { name: "Lemmy", type: "person", mbid: "e3ea6186-7523-48de-8437-bac91bc47829" },
  { name: "Dave Mustaine", type: "person", mbid: "2f58d07c-4ed6-4f29-8b10-95266e16fe1b" },

  // --- R&B / Soul / Funk ---
  { name: "Prince", type: "person", mbid: "070d193a-845c-479f-980e-bef15710653e" },
  { name: "Stevie Wonder", type: "person", mbid: "1ee18fb3-18a6-4c7f-8ba0-bc41cdd0462e" },
  { name: "Michael Jackson", type: "person", mbid: "f27ec8db-af05-4f36-916e-3d57f91ecf5e" },
  { name: "James Brown", type: "person", mbid: "20ff3303-4fe2-4a47-a1b6-291e26aa3438" },

  // --- Singer-Songwriters ---
  { name: "Bob Dylan", type: "person", mbid: "72c536dc-7137-4477-a521-567eeb840fa8" },
  { name: "Tom Waits", type: "person", mbid: "c3aeb863-7b26-4388-94e8-5a240f2be21b" },
  { name: "Nick Cave", type: "person", mbid: "4aae17a7-9f0c-487b-b60e-f8eafb410b1d" },
  { name: "Johnny Cash", type: "person", mbid: "d43d12a1-2dc9-4257-a2fd-0a3bb1081b86" },
  { name: "Kate Bush", type: "person", mbid: "4b585938-f271-45e2-b19a-91c634b5e396" },
  { name: "Björk", type: "person", mbid: "87c5dedd-371d-4a53-9f7f-80522fb7f3cb" },
  { name: "PJ Harvey", type: "person", mbid: "e795e03d-b5d5-4a5f-834d-162cfb308a2c" },

  // --- Producers ---
  { name: "Brian Eno", type: "person", mbid: "ff95eb47-41c4-4f7f-a104-cdc30f02e872" },
  { name: "Rick Rubin", type: "person", mbid: "07aebfa0-55d6-47e0-a284-12330e3eae0d" },
  { name: "Danger Mouse", type: "person", mbid: "4b356f05-bcc2-4544-925b-fd9a1bf708be" },
  { name: "Nigel Godrich", type: "person", mbid: "52de022d-5401-427f-8301-ff1b8be11a7a" },
  { name: "Jack Antonoff", type: "person", mbid: "1155a7a9-a7b4-46ba-ba27-6b6c98be487e" },
  { name: "Mark Ronson", type: "person", mbid: "c3c82bdc-d9e7-4836-9746-c24ead47ca19" },
  { name: "Quincy Jones", type: "person", mbid: "5803c81e-739a-4057-9a5c-cf84e55db630" },
  { name: "Butch Vig", type: "person", mbid: "ba30915c-4d33-43c5-8c37-ead0b8061517" },

  // --- Iconic Bands (recognizable, no single iconic frontperson) ---
  { name: "Led Zeppelin", type: "group", mbid: "678d88b2-87b0-403b-b63d-5da7465aecc3" },
  { name: "The Rolling Stones", type: "group", mbid: "b071f9fa-14b0-4217-8e97-eb41da73f598" },
  { name: "Pink Floyd", type: "group", mbid: "83d91898-7763-47d7-b03b-b92132375c47" },
  { name: "The Beatles", type: "group", mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" },
  { name: "Queen", type: "group", mbid: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3" },
  { name: "The Who", type: "group", mbid: "9fdaa16b-a6c4-4831-b87c-bc9ca8ce7eaa" },
  { name: "Fleetwood Mac", type: "group", mbid: "bd13909f-1c29-4c27-a874-d4aaf27c5b1a" },
  { name: "Nirvana", type: "group", mbid: "5b11f4ce-a62d-471e-81fc-a69a8278c7da" },
  { name: "Foo Fighters", type: "group", mbid: "67f66c07-6e61-4026-ade5-7e782fad3a5d" },
  { name: "Soundgarden", type: "group", mbid: "153c9281-268f-4cf3-8938-f5a4593e5df4" },
  { name: "Pearl Jam", type: "group", mbid: "83b9cbe7-9857-49e2-ab8e-b57b01038103" },
  { name: "Red Hot Chili Peppers", type: "group", mbid: "8bfac288-ccc5-448d-9573-c33ea2aa5c30" },
  { name: "Radiohead", type: "group", mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711" },
  { name: "Arctic Monkeys", type: "group", mbid: "ada7a83c-e3e1-40f1-93f9-3e73dbc9298a" },
  { name: "Queens of the Stone Age", type: "group", mbid: "7dc8f5bd-9d0b-4087-9f73-dc164950bbd8" },
  { name: "The Strokes", type: "group", mbid: "f181961b-20f7-459e-89de-920ef03c7ed0" },
  { name: "The Black Keys", type: "group", mbid: "d15721d8-56b4-453d-b506-fc915b14cba2" },
  { name: "Oasis", type: "group", mbid: "39ab1aed-75e0-4140-bd47-540276886b60" },
  { name: "Blur", type: "group", mbid: "ba853904-ae25-4ebb-89d6-c44cfbd71bd2" },
  { name: "Gorillaz", type: "group", mbid: "e21857d5-3256-4547-afb3-4b6ded592596" },
  { name: "Metallica", type: "group", mbid: "65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab" },
  { name: "Black Sabbath", type: "group", mbid: "5182c1d9-c7d2-4dad-afa0-ccfeada921a8" },
  { name: "Iron Maiden", type: "group", mbid: "ca891d65-d9b0-4258-89f7-e6ba29d83767" },
  { name: "AC/DC", type: "group", mbid: "66c662b6-6e2f-4930-8610-912e24c63ed1" },
  { name: "The Clash", type: "group", mbid: "8f92558c-2baa-4758-8c38-615519e9deda" },
  { name: "Joy Division", type: "group", mbid: "9a58fda3-f4ed-4080-a3a5-f457aac9fcdd" },
  { name: "New Order", type: "group", mbid: "f1106b17-dcbb-45f6-b938-199ccfab50cc" },
  { name: "The Cure", type: "group", mbid: "69ee3720-a7cb-4402-b48d-a02c366f2bcf" },
  { name: "Rage Against the Machine", type: "group", mbid: "3798b104-01cb-484c-a3b0-56adc6399b80" },
  { name: "Nine Inch Nails", type: "group", mbid: "b7ffd2af-418f-4be2-bdd1-22f8b48613da" },
  { name: "Tool", type: "group", mbid: "66fc5bf8-daa4-4241-b378-9bc9077939d2" },
  { name: "OutKast", type: "group", mbid: "73fdb566-a9b1-494c-9f32-51768ec9fd27" },
  { name: "Wu-Tang Clan", type: "group", mbid: "0febdcf7-4e1f-4661-9493-b40427de2c13" },
  { name: "A Tribe Called Quest", type: "group", mbid: "9689aa5a-4471-4fb4-9721-07cecda0fa9f" },
  { name: "The Roots", type: "group", mbid: "80b3cf5e-18fe-4c59-98c7-e5bb87210710" },
  { name: "N.W.A", type: "group", mbid: "3a54bffa-2314-44a2-927b-60144119c780" },
  { name: "Beastie Boys", type: "group", mbid: "9beb62b2-88db-4cea-801e-162cd344ee53" },
  { name: "Daft Punk", type: "group", mbid: "056e4f3e-d505-4dad-8ec1-d04f521cbb56" },
  { name: "Massive Attack", type: "group", mbid: "10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8" },
  { name: "Tame Impala", type: "group", mbid: "63aa26c3-d59b-4da4-84ac-716b54f1ef4d" },
  { name: "LCD Soundsystem", type: "group", mbid: "2aaf7396-6ab8-40f3-9776-a41c42c8e26b" },
  { name: "Arcade Fire", type: "group", mbid: "52074ba6-e495-4ef3-9bb4-0703888a9f68" },
  { name: "The White Stripes", type: "group", mbid: "11ae9fbb-f3d7-4a47-936f-4c0a04d3b3b5" },
  { name: "Osees", type: "group", mbid: "194272cc-dcc8-4640-a4a6-66da7d250d5c" },
  { name: "King Gizzard & the Lizard Wizard", type: "group", mbid: "f58384a4-2ad2-4f24-89c5-c7b74ae1cce7" },
  { name: "Earth, Wind & Fire", type: "group", mbid: "535afeda-2538-435d-9dd1-5e10be586774" },
  { name: "Talking Heads", type: "group", mbid: "a94a7155-c79d-4409-9fcf-220cb0e4dc3a" },
  { name: "Depeche Mode", type: "group", mbid: "8538e728-ca0b-4321-b7e5-cff6565dd4c0" },
  { name: "Kraftwerk", type: "group", mbid: "5700dcd4-c139-4f31-aa3e-6382b9af9032" },
];
