import test from "node:test";
import assert from "node:assert/strict";
import {classifyCivicDecisionTitle} from "../lib/civic-decision.mjs";
test("regulation change is not a concrete play street",()=>assert.deepEqual(classifyCivicDecisionTitle("Districtswerking en decentralisatie - Toelating tijdelijk gebruik straat als speelstraat. Wijziging aanvullend verkeersreglement - Goedkeuring"),{category:"play_street_rule",publishCandidate:false}));
test("play street refusal is excluded",()=>assert.deepEqual(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten buitenspeeldag mei 2026. Weigering - Goedkeuring"),{category:"play_street_refusal",publishCandidate:false}));
test("approved play street period is candidate",()=>assert.deepEqual(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten paasvakantie 2026 - Goedkeuring"),{category:"play_street_approval",publishCandidate:true}));
test("summer batch is candidate",()=>assert.equal(classifyCivicDecisionTitle("Binnengemeentelijke decentralisatie - Aanvullend verkeersreglement. Aanvragen speelstraten augustus 2026 - Deel III - Goedkeuring").publishCandidate,true));
test("fair approval is candidate",()=>assert.deepEqual(classifyCivicDecisionTitle("District Antwerpen - Najaarsfoor Dageraadplaats 2026 - Goedkeuring"),{category:"fair_calendar_candidate",publishCandidate:true}));
test("unrelated decision stays out",()=>assert.deepEqual(classifyCivicDecisionTitle("Publieke ruimte - Heraanleg plein - Goedkeuring"),{category:"other",publishCandidate:false}));
