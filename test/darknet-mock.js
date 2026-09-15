// Node-only test-harness mock of the Bitburner Darknet minigame: server generation,
// password-checking feedback, and the labyrinth maze. Ported from
// bitburner-src/src/DarkNet/{controllers/ServerGenerator.ts, effects/authentication.ts,
// effects/labyrinth.ts, utils/darknetAuthUtils.ts, models/dictionaryData.ts,
// models/packetSniffing.ts}, Bitburner v3.0.1.
//
// Every Math.random() call in the ported game source is replaced with a threaded
// rng() function (see makeRng) so tests are fully deterministic. This file is never
// loaded by the game; it has no RAM-collision constraints and is Node-only.

const MAX_PASSWORD_LENGTH = 50;

// ---- dictionaries, copied verbatim from DarkNet/models/dictionaryData.ts ----
const numbers = "0123456789";
const lettersLowercase = "abcdefghijklmnopqrstuvwxyz";
const lettersUppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const letters = lettersLowercase + lettersUppercase;
const filler = "/[]╬╸.-()*~:;><#\\";

const defaultSettingsDictionary = ["admin", "password", "0000", "12345"];
const dogNameDictionary = ["fido", "spot", "rover", "max"];

const EUCountries = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark", "Estonia",
    "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
    "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
];

const commonPasswordDictionary = [
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567", "dragon",
    "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow", "master", "666666",
    "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321", "superman", "1qaz2wsx", "7777777",
    "121212", "0", "qazwsx", "123qwe", "trustno1", "jordan", "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster",
    "soccer", "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert",
    "thomas", "hockey", "ranger", "daniel", "starwars", "112233", "george", "computer", "michelle", "jessica",
    "pepper", "1111", "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
    "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love", "ashley", "6969", "nicole",
    "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas", "austin", "thunder", "taylor",
    "matrix",
];

const smallPrimes = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
];
const largePrimes = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
    2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
    4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
    6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
    9343, 9467, 9551, 9601, 9739, 9749, 9859,
];

// ---- deterministic RNG (mulberry32) ----
export function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

// ---- DarkNet/Enums.ts ModelIds ----
const MODEL_IDS = {
    EchoVuln: "DeskMemo_3.1",
    SortedEchoVuln: "PHP 5.4",
    NoPassword: "ZeroLogon",
    Captcha: "CloudBlare(tm)",
    DefaultPassword: "FreshInstall_1.0",
    BufferOverflow: "Pr0verFl0",
    MastermindHint: "DeepGreen",
    TimingAttack: "2G_cellular",
    LargestPrimeFactor: "PrimeTime 2",
    RomanNumeral: "BellaCuore",
    DogNames: "Laika4",
    GuessNumber: "AccountsManager_4.2",
    CommonPasswordDictionary: "TopPass",
    EUCountryDictionary: "EuroZone Free",
    Yesn_t: "NIL",
    BinaryEncodedFeedback: "110100100",
    SpiceLevel: "RateMyPix.Auth",
    ConvertToBase10: "OctantVoxel",
    parsedExpression: "MathML",
    divisibilityTest: "Factori-Os",
    tripleModulo: "BigMo%od",
    globalMaxima: "KingOfTheHill",
    packetSniffer: "OpenWebAccessPoint",
    encryptedPassword: "OrdoXenos",
    labyrinth: "(The Labyrinth)",
};

// Every crackable model id (every ModelIds entry except the labyrinth, which has no
// "password"/checkPassword flow of its own -- it's exercised via makeLab/labStep/labReport).
export const MODELS = Object.values(MODEL_IDS).filter((id) => id !== MODEL_IDS.labyrinth);

// ---- ServerGenerator.ts helpers ----
function clampNumber(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.max(Math.min(value, max), min);
}

function getPassword(rng, length, allowLetters = false) {
    const characters = numbers + (allowLetters ? letters : "");
    let password = "";
    const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH);
    for (let i = 0; i < cappedLength; i++) {
        password += characters[Math.floor(rng() * characters.length)];
    }
    if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
        password = password.slice(0, 15);
    }
    if (!allowLetters) {
        return Number(password).toString();
    }
    return password;
}

function getFillerChars(rng) {
    let result = "";
    const num = Math.ceil(rng() * 3);
    for (let i = 0; i < num; i++) {
        result += filler[Math.floor(rng() * filler.length)];
    }
    return result;
}

function romanNumeralEncoder(input) {
    const romanNumerals = {
        1: "I", 4: "IV", 5: "V", 9: "IX", 10: "X", 40: "XL", 50: "L", 90: "XC",
        100: "C", 400: "CD", 500: "D", 900: "CM", 1000: "M",
    };
    const keys = Object.keys(romanNumerals).map(Number);
    let result = "";
    for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        while (input >= key) {
            result += romanNumerals[key];
            input -= key;
        }
    }
    return result || "nulla";
}

function encodeNumberInBaseN(decimalNumber, base) {
    const characters = [...numbers.split(""), ...lettersUppercase.split("")];
    let digits = Math.floor(Math.log(decimalNumber) / Math.log(base));
    let remaining = decimalNumber;
    let result = "";
    while (remaining >= 0.0001 || digits >= 0) {
        if (digits === -1) {
            result += ".";
        }
        const place = Math.floor(remaining / base ** digits);
        result += characters[place];
        remaining -= place * base ** digits;
        digits -= 1;
    }
    return result;
}

// Ported for parity with ServerGenerator.ts; not exercised by makeServer/feedback directly,
// but kept available for solver work in later tasks (decoding an OctantVoxel hint).
export function parseBaseNNumberString(numberString, base) {
    const characters = [...numbers.split(""), ...lettersUppercase.split("")];
    let result = 0;
    let index = 0;
    let digit = numberString.split(".")[0].length - 1;
    while (index < numberString.length) {
        const currentDigit = numberString[index];
        if (currentDigit === ".") {
            index += 1;
            continue;
        }
        result += characters.indexOf(currentDigit) * base ** digit;
        index += 1;
        digit -= 1;
    }
    return result;
}

function cleanArithmeticExpression(expression) {
    return expression
        .replaceAll("ҳ", "*")
        .replaceAll("÷", "/")
        .replaceAll("➕", "+")
        .replaceAll("➖", "-")
        .replaceAll("ns.exit(),", "")
        .split(",")[0];
}

function parseSimpleArithmeticExpression(expression) {
    const tokens = cleanArithmeticExpression(expression).split("");

    let currentDepth = 0;
    const depth = tokens.map((token) => {
        if (token === "(") {
            currentDepth += 1;
        } else if (token === ")") {
            currentDepth -= 1;
            return currentDepth + 1;
        }
        return currentDepth;
    });
    const depth1Start = depth.indexOf(1);
    const firstZeroAfterDepth1Start = depth.indexOf(0, depth1Start);
    const depth1End = firstZeroAfterDepth1Start === -1 ? depth.length - 1 : firstZeroAfterDepth1Start - 1;
    if (depth1Start !== -1) {
        const subExpression = tokens.slice(depth1Start + 1, depth1End).join("");
        const result = parseSimpleArithmeticExpression(subExpression);
        tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString());
        return parseSimpleArithmeticExpression(tokens.join(""));
    }

    let remainingExpression = tokens.join("");
    const multiplicationDivisionRegex = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/;
    let match = remainingExpression.match(multiplicationDivisionRegex);
    while (match) {
        const [, left, operator, right] = match;
        const result = operator === "*" ? parseFloat(left) * parseFloat(right) : parseFloat(left) / parseFloat(right);
        const resultString = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString();
        remainingExpression = remainingExpression.replace(match[0], resultString);
        match = remainingExpression.match(multiplicationDivisionRegex);
    }

    const additionSubtractionRegex = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/;
    match = remainingExpression.match(additionSubtractionRegex);
    while (match) {
        const [, left, operator, right] = match;
        const result = operator === "+" ? parseFloat(left) + parseFloat(right) : parseFloat(left) - parseFloat(right);
        remainingExpression = remainingExpression.replace(match[0], result.toString());
        match = remainingExpression.match(additionSubtractionRegex);
    }

    const [, leftover] = remainingExpression.match(/(-?\d*\.?\d+)/) ?? ["", ""];
    return parseFloat(leftover);
}

const ARITHMETIC_OPERATORS = ["+", "-", "*", "/"];

function generateSimpleArithmeticExpression(difficulty, rng) {
    const operatorCount = Math.floor(difficulty / 4);
    const expression = [];
    for (let i = 0; i < operatorCount; i++) {
        expression.push(Math.ceil(rng() * 98));
        expression.push(pick(rng, ARITHMETIC_OPERATORS));

        if (difficulty > 5 && rng() < difficulty / (difficulty + 50)) {
            expression.push("(");
            expression.push(generateSimpleArithmeticExpression(difficulty / 2, rng));
            expression.push(")");
            expression.push(pick(rng, ARITHMETIC_OPERATORS));
        }
    }
    expression.push(Math.ceil(rng() * 98));

    const result = expression.join(" ");

    try {
        const calc = parseSimpleArithmeticExpression(cleanArithmeticExpression(result));
        if (Math.abs(calc) < 0.1) {
            return generateSimpleArithmeticExpression(difficulty, rng);
        }
    } catch {
        return generateSimpleArithmeticExpression(difficulty, rng);
    }

    if (difficulty > 18) {
        return result.replaceAll("*", "ҳ").replaceAll("/", "÷").replaceAll("+", "➕").replaceAll("-", "➖");
    }
    return result;
}

function getCodeInjection() {
    return ` , !globalThis.pwn3d && (globalThis.pwn3d=true, alert("You've been hacked! You evaluated a string and let me inject code, didn't you? HAHAHAHA!") , globalThis.openDevMenu() ) , ns.exit()`;
}

function getLargestPrimeFactorPassword(difficulty, rng) {
    const factorCount = 1 + Math.min(5, Math.floor(difficulty / 3));
    const largePrimeIndex = 2 + Math.floor(rng() * (largePrimes.length - 2));
    const largestPrime = largePrimes[largePrimeIndex];
    let number = largestPrime;
    for (let i = 1; i <= factorCount; i++) {
        number *= pick(rng, smallPrimes);
    }
    return { largestPrime, targetNumber: number };
}

function getPasswordMadeUpOfPrimesProduct(difficulty, rng) {
    const scale = Math.min(difficulty / 2, 15);
    let password;
    do {
        password = BigInt(Math.floor(rng() * 5 * (scale + 1)) + 1);
        for (let i = 0; i < scale / 3; i++) {
            if (rng() < 0.5) {
                password *= BigInt(Math.ceil(rng() * 5));
            } else {
                password *= BigInt(pick(rng, smallPrimes));
            }
        }
        if (difficulty > 12) {
            password *= BigInt(pick(rng, largePrimes));
        }
        if (difficulty > 24) {
            password *= BigInt(pick(rng, largePrimes));
        }
    } while (BigInt(Number(password)) !== password);
    return password.toString();
}

// ---- per-model server builders (ServerGenerator.ts get*Config functions) ----
const HINTS_ECHO_VULN = ["The password is", "The PIN is", "Remember to use", "It's set to", "The key is", "The secret is"];
const HINTS_SORTED_ECHO = ["The password is shuffled", "The key is made from", "I accidentally sorted the password:", "The PIN uses"];
const HINTS_NO_PASSWORD = ["The password is not set", "There is no password", "The PIN is empty", "Did I set a code?", "I didn't set a password"];
const HINTS_DEFAULT_PASSWORD = ["The password is the default password", "It's still the default", "The default password is set", "I never changed the password", "It's still the factory settings"];
const HINTS_DOG_NAMES = ["It's my dog's name", "It's the dog's name", "my first dog's name"];
const HINTS_TIMING_ATTACK = [
    "I thought about it for some time, but that is not the password.",
    "I spent a while on it, but that's not right",
    "I considered it for a bit, but that's not it",
    "I spent some time on it, but that's not the password",
];

function dictionaryAttack(rng, dictionary, hintTemplates) {
    return { password: pick(rng, dictionary), staticPasswordHint: pick(rng, hintTemplates) };
}

const BUILDERS = {
    [MODEL_IDS.EchoVuln]: (difficulty, rng) => {
        const password = getPassword(rng, 3);
        return { password, staticPasswordHint: `${pick(rng, HINTS_ECHO_VULN)} ${password}` };
    },
    [MODEL_IDS.SortedEchoVuln]: (difficulty, rng) => {
        const password = getPassword(rng, Math.min(2 + difficulty / 7, 9));
        const sortedPassword = password.split("").sort().join("");
        return {
            password,
            staticPasswordHint: `${pick(rng, HINTS_SORTED_ECHO)} ${sortedPassword}`,
            passwordHintData: sortedPassword,
        };
    },
    [MODEL_IDS.NoPassword]: (difficulty, rng) => dictionaryAttack(rng, [""], HINTS_NO_PASSWORD),
    [MODEL_IDS.DefaultPassword]: (difficulty, rng) => dictionaryAttack(rng, defaultSettingsDictionary, HINTS_DEFAULT_PASSWORD),
    [MODEL_IDS.Captcha]: (difficulty, rng) => {
        const password = getPassword(rng, difficulty / 2 + 3);
        const filledPassword = password
            .split("")
            .map((char, i) => (i >= password.length - 1 ? char : char + getFillerChars(rng)))
            .join("");
        return { password, staticPasswordHint: "Type the numbers to prove you are human", passwordHintData: filledPassword };
    },
    [MODEL_IDS.DogNames]: (difficulty, rng) => dictionaryAttack(rng, dogNameDictionary, HINTS_DOG_NAMES),
    [MODEL_IDS.MastermindHint]: (difficulty, rng) => {
        const alphanumeric = difficulty > 16 && rng() < 0.3;
        const passwordLength = Math.min((alphanumeric ? -1 : 2) + difficulty / 5, 10);
        return { password: getPassword(rng, passwordLength, alphanumeric), staticPasswordHint: "Only a true master may pass" };
    },
    [MODEL_IDS.TimingAttack]: (difficulty, rng) => {
        const alphanumeric = difficulty > 16 && rng() < 0.3;
        const length = Math.min((alphanumeric ? 0 : 3) + difficulty / 4, 8);
        return { password: getPassword(rng, length, alphanumeric), staticPasswordHint: pick(rng, HINTS_TIMING_ATTACK) };
    },
    [MODEL_IDS.RomanNumeral]: (difficulty, rng) => {
        const password = Math.floor(rng() * 10 * (10 * (difficulty + 1)));
        if (difficulty < 8) {
            const encodedPassword = romanNumeralEncoder(password);
            return {
                password: `${password}`,
                staticPasswordHint: `The password is the value of the number '${encodedPassword}'`,
                passwordHintData: encodedPassword,
            };
        }
        const passwordRangeMin = rng() < 0.3 ? 0 : Math.floor(password * (rng() * 0.2 + 0.6));
        const passwordRangeMax = password + Math.floor(rng() * difficulty * 10 + 10);
        const encodedMin = romanNumeralEncoder(passwordRangeMin);
        const encodedMax = romanNumeralEncoder(passwordRangeMax);
        return {
            password: `${password}`,
            staticPasswordHint: `The password is between '${encodedMin}' and '${encodedMax}'`,
            passwordHintData: `${encodedMin},${encodedMax}`,
        };
    },
    [MODEL_IDS.LargestPrimeFactor]: (difficulty, rng) => {
        const { largestPrime, targetNumber } = getLargestPrimeFactorPassword(difficulty, rng);
        return {
            password: `${largestPrime}`,
            staticPasswordHint: `The password is the largest prime factor of ${targetNumber}`,
            passwordHintData: `${targetNumber}`,
        };
    },
    [MODEL_IDS.GuessNumber]: (difficulty, rng) => {
        const password = `${Math.floor((rng() * 10 * (difficulty + 3)) / 3)}`;
        const maxNumber = 10 ** password.length;
        return { password, staticPasswordHint: `The password is a number between 0 and ${maxNumber}` };
    },
    [MODEL_IDS.CommonPasswordDictionary]: (difficulty, rng) => dictionaryAttack(rng, commonPasswordDictionary, ["It's a common password"]),
    [MODEL_IDS.EUCountryDictionary]: (difficulty, rng) => dictionaryAttack(rng, EUCountries, ["My favorite EU country"]),
    [MODEL_IDS.Yesn_t]: (difficulty, rng) => ({
        password: getPassword(rng, 3 + difficulty / 2, difficulty > 8),
        staticPasswordHint: "you are one who's'nt authorized",
    }),
    [MODEL_IDS.BufferOverflow]: (difficulty, rng) => {
        const length = Math.floor(4 + rng() * 4);
        return { password: getPassword(rng, length, true), staticPasswordHint: `Warning: password buffer is ${length} bytes` };
    },
    [MODEL_IDS.BinaryEncodedFeedback]: (difficulty, rng) => {
        const password = getPassword(rng, 2 + difficulty / 5, difficulty > 8);
        const binaryEncodedPassword = password
            .split("")
            .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
            .join(" ");
        return { password, staticPasswordHint: "beep boop", passwordHintData: binaryEncodedPassword };
    },
    [MODEL_IDS.encryptedPassword]: (difficulty, rng) => {
        const password = getPassword(rng, 3 + rng() * 3, true);
        let passwordWithXorMaskApplied;
        let xorMaskStrings;
        do {
            passwordWithXorMaskApplied = "";
            xorMaskStrings = [];
            for (const c of password) {
                const charCode = c.charCodeAt(0);
                const xorMask = Math.floor(rng() * 32);
                xorMaskStrings.push(xorMask.toString(2).padStart(8, "0"));
                passwordWithXorMaskApplied += String.fromCharCode(charCode ^ xorMask);
            }
        } while (passwordWithXorMaskApplied.includes(";") || passwordWithXorMaskApplied.includes(" "));
        return {
            password,
            staticPasswordHint: `XOR mask encrypted password: "${passwordWithXorMaskApplied}".`,
            passwordHintData: `${passwordWithXorMaskApplied};${xorMaskStrings.join(" ")}`,
        };
    },
    [MODEL_IDS.SpiceLevel]: (difficulty, rng) => ({
        password: getPassword(rng, 3 + difficulty / 3, difficulty > 8),
        staticPasswordHint: "!!🌶️!!",
    }),
    [MODEL_IDS.ConvertToBase10]: (difficulty, rng) => {
        const password = Math.ceil(rng() * 99 * (difficulty + 1));
        const bases = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
        let base = pick(rng, bases);
        if (difficulty > 12) {
            base += pick(rng, bases) / 10;
        }
        const encodedPassword = encodeNumberInBaseN(password, base);
        return {
            password: `${password}`,
            staticPasswordHint: `the password is the base ${base} number ${encodedPassword} in base 10`,
            passwordHintData: `${base},${encodedPassword}`,
        };
    },
    [MODEL_IDS.parsedExpression]: (difficulty, rng) => {
        let expression = generateSimpleArithmeticExpression(difficulty, rng);
        const result = parseSimpleArithmeticExpression(expression);
        if (difficulty > 12) {
            expression = expression.replaceAll("*", "ҳ").replaceAll("/", "÷").replaceAll("+", "➕").replaceAll("-", "➖");
        }
        if ((difficulty > 16 && rng() < 0.3) || rng() < 0.01) {
            expression += getCodeInjection();
        }
        const parenCount = expression.split("(").length - 1;
        if (difficulty > 20 && rng() < 0.3 && parenCount > 1) {
            expression = expression.replace("(", "(ns.exit(),");
        }
        return { password: `${result}`, staticPasswordHint: "The password is the evaluation of this expression", passwordHintData: expression };
    },
    [MODEL_IDS.divisibilityTest]: (difficulty, rng) => ({
        password: getPasswordMadeUpOfPrimesProduct(difficulty, rng),
        staticPasswordHint: `The password is divisible by 1 ;)`,
    }),
    [MODEL_IDS.tripleModulo]: (difficulty, rng) => ({
        password: `${getPassword(rng, 3 + difficulty / 5)}`,
        staticPasswordHint: `(password % n) % (n % 32)`,
    }),
    [MODEL_IDS.globalMaxima]: (difficulty, rng) => ({
        password: getPassword(rng, Math.min(1 + difficulty / 6, 10)),
        staticPasswordHint: "Ascend the highest mountain!",
    }),
    [MODEL_IDS.packetSniffer]: (difficulty, rng) => ({
        password: getPassword(rng, 3 + rng() * 6, difficulty > 8),
        staticPasswordHint: "(I'm busy browsing social media at the cafe)",
    }),
};

// Hostname flavor is not exercised by solvers, so it doesn't need to match the game's
// dictionary-driven generator exactly -- just be present and deterministic given rng.
const HOST_PREFIXES = ["neo", "bit", "hydro", "cyber", "dark", "net", "crypto", "zero_day", "quantum", "rogue"];
const HOST_SUFFIXES = ["corp", "sys", "net", "web", "tech", "grid", "hub", "systems", "security", "matrix"];

function makeHostname(rng) {
    return `${pick(rng, HOST_PREFIXES)}_${pick(rng, HOST_SUFFIXES)}_${Math.floor(rng() * 100000)}`;
}

// Simplified stand-in for DnetServerBuilder's requiredLevel calculation (which depends on
// the player's current labyrinth progress, not modeled here): scales with difficulty using
// the mid-tier labyrinth (depth 19, cha 1500) as a fixed reference point.
function requiredCharisma(difficulty, rng) {
    const referenceDepth = 19;
    const referenceCha = 1500;
    const depthScaling = difficulty < 2 ? difficulty * 10 : (difficulty / referenceDepth) ** 1.5 * referenceCha * 0.85;
    const levelVariance = (rng() * 3 - 1) * difficulty;
    return Math.max(Math.floor(depthScaling + levelVariance), 1);
}

export function makeServer(modelId, difficulty, rng) {
    const builder = BUILDERS[modelId];
    if (!builder) {
        throw new Error(`Unknown darknet model id: ${modelId}`);
    }
    const config = builder(difficulty, rng);
    const password = config.password;
    return {
        hostname: makeHostname(rng),
        modelId,
        difficulty,
        password,
        staticPasswordHint: config.staticPasswordHint,
        passwordHintData: config.passwordHintData ?? "",
        passwordLength: password.length,
        passwordFormat: /^[0-9]+$/.test(password) ? "numeric" : "alphanumeric",
        requiredCharismaSkill: requiredCharisma(difficulty, rng),
    };
}

// ---- darknetAuthUtils.ts ----
function getExactCorrectChars(password, attempted) {
    return password.split("").map((digit, i) => digit === attempted[i]);
}

function getExactCorrectCharsCount(password, attempted) {
    return getExactCorrectChars(password, attempted).filter(Boolean).length;
}

function getMisplacedCorrectCharsCount(password, attempted) {
    const remainingPasswordChars = password.split("").filter((digit, i) => digit !== attempted[i]);
    const remainingAttemptedChars = attempted.split("").filter((digit, i) => digit !== password[i]);

    const misplacedCorrectChars = remainingAttemptedChars.filter((digit, i) => {
        const isPresentInPassword = remainingPasswordChars.includes(digit);
        const countInAttemptedThusFar = remainingAttemptedChars.slice(0, i).filter((prevDigit) => prevDigit === digit).length;
        const countInPassword = remainingPasswordChars.filter((prevDigit) => prevDigit === digit).length;
        return isPresentInPassword && countInAttemptedThusFar < countInPassword;
    });

    return misplacedCorrectChars.length;
}

// checkPassword's real ConvertToBase10/parsedExpression branch uses parseFloat(attempted),
// which happily parses a valid number followed by trailing garbage (e.g. parseFloat("83x")
// === 83). That means "password + garbage" would still authenticate for those two models,
// which isn't a meaningful "wrong password" test. We use the stricter Number(attempted)
// here (NaN on any trailing garbage) so the mock's success/failure boundary stays
// meaningful for every model, while preserving the same floating-point tolerance
// (isCloseToCorrectPassword) for legitimate numeric answers.
function isCloseToCorrectPassword(correctPassword, attemptedPassword) {
    const difference = Math.abs(attemptedPassword - Number(correctPassword));
    return difference < 0.01 || difference / Number(correctPassword) < 0.005;
}

// ---- Casino/RNG.ts WHRNG, used by getKingOfTheHillAltitude ----
class WHRNG {
    constructor(totalPlaytime) {
        const v = (totalPlaytime / 1000) % 30000;
        this.s1 = v;
        this.s2 = v;
        this.s3 = v;
    }
    step() {
        this.s1 = (171 * this.s1) % 30269;
        this.s2 = (172 * this.s2) % 30307;
        this.s3 = (170 * this.s3) % 30323;
    }
    random() {
        this.step();
        return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0;
    }
}

function getAltitudeGivenHillSpecs(x, location, height, width) {
    return height * Math.exp(((x - location) ** 2 / width ** 2) * -1);
}

function getKingOfTheHillAltitude(server, attemptedPassword) {
    const password = Number(server.password);
    const x = Number(attemptedPassword);
    const rng = new WHRNG(password);
    const hillCount = Math.min(Math.floor(server.difficulty / 8), 4) * 2 + 1;
    const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
    const width = 10 ** Math.max(server.password.length - 2, 0) + 1;

    if (Math.abs((x - password) / password) < 0.03) {
        return getAltitudeGivenHillSpecs(x, password, 10000, width);
    }

    let altitude = 0;
    for (let i = 0; i < hillCount; i++) {
        const locationOffset = (i - passwordHillIndex) * width * 3 * (rng.random() * 0.2 + 0.9);
        const heightOffset = Math.abs((i - passwordHillIndex) * 2600) * (rng.random() * 0.1 + 0.95);
        altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, 10000 - heightOffset, width);
    }
    return altitude;
}

// ---- packetSniffing.ts capturePackets, simplified per the task brief: noise is random
// alphanumerics of the delimited data's length, with the password embedded at a random
// index using the " host:pw " delimiters for difficulty <= 16 (bare password otherwise). ----
function capturePackets(server) {
    const passwordData = server.difficulty > 16 ? server.password : ` ${server.hostname}:${server.password} `;
    const noiseLength = Math.max(124, passwordData.length + 40);
    const alphabet = numbers + letters;
    let noise = "";
    for (let i = 0; i < noiseLength; i++) {
        noise += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const insertIndex = Math.floor(Math.random() * (noise.length - passwordData.length + 1));
    return noise.slice(0, insertIndex) + passwordData + noise.slice(insertIndex);
}

// ---- authentication.ts checkPassword ----
export function feedback(server, attempt) {
    if (server.password === attempt) {
        return { success: true, code: 200, message: "Success", data: undefined };
    }

    const fail = (message, data) => ({ success: false, code: 401, message, data });

    switch (server.modelId) {
        case MODEL_IDS.MastermindHint: {
            const exactCharacters = getExactCorrectCharsCount(server.password, attempt);
            const misplacedCharacters = getMisplacedCorrectCharsCount(server.password, attempt);
            const exactCharsMessage = `${exactCharacters} symbol${exactCharacters == 1 ? " is" : "s are"} match exactly`;
            const misplacedCharsMessage = `${misplacedCharacters} symbol${misplacedCharacters == 1 ? "" : "s"} match but ${
                misplacedCharacters == 1 ? "is" : "are"
            } in the wrong place`;
            return fail(`Hint: ${exactCharsMessage},  and ${misplacedCharsMessage}.`, `${exactCharacters},${misplacedCharacters}`);
        }
        case MODEL_IDS.GuessNumber: {
            const hintData = Number(attempt) > Number(server.password) ? "Lower" : "Higher";
            return fail(server.staticPasswordHint, hintData);
        }
        case MODEL_IDS.RomanNumeral: {
            const hintData = Number(attempt) > Number(server.password) ? "ALTUS NIMIS" : "PARUM BREVIS";
            return fail(server.staticPasswordHint, hintData);
        }
        case MODEL_IDS.Yesn_t: {
            const response = attempt
                .split("")
                .map((char, i) => (char === server.password[i] ? "yes" : "yesn't"))
                .join(",");
            return fail("that wasn't right", response);
        }
        case MODEL_IDS.SpiceLevel: {
            const exactChars = getExactCorrectChars(server.password, attempt);
            const pepperRepresentation = exactChars.map((val) => (val ? "🌶️" : "")).join("") || "0";
            return fail("Not spicy enough", `${pepperRepresentation}/${server.password.length}`);
        }
        case MODEL_IDS.divisibilityTest: {
            const password = Number(server.password);
            const attemptedDivisor = Number(attempt);
            if (Number.isNaN(+attempt) || password % attemptedDivisor || attempt === "") {
                return fail(`Password is not divisible by '${attempt}'`, "false");
            }
            return fail(`Password IS divisible by '${attempt}'`, "true");
        }
        case MODEL_IDS.tripleModulo: {
            const password = Number(server.password);
            const input = Number(attempt);
            const result = (password % input) % (((input - 1) % 32) + 1);
            const message =
                input % 32 === 0
                    ? `(Password % ${input}) % 32 = ${result}`
                    : `(Password % ${input}) % (${input} % 32) = ${result}`;
            return fail(message, result.toString());
        }
        case MODEL_IDS.ConvertToBase10:
        case MODEL_IDS.parsedExpression: {
            const parsedAttempt = Number(attempt);
            if (!Number.isNaN(parsedAttempt) && isCloseToCorrectPassword(server.password, parsedAttempt)) {
                return { success: true, code: 200, message: "Success", data: undefined };
            }
            return fail(server.staticPasswordHint, server.passwordHintData);
        }
        case MODEL_IDS.TimingAttack: {
            const indexOfDifference = server.password.split("").findIndex((char, i) => char !== attempt[i]);
            const hint = `Found a mismatch while checking each character (${indexOfDifference})`;
            return fail(hint, `Response time: 0ms`);
        }
        case MODEL_IDS.BufferOverflow: {
            const maskCharacter = attempt === "■".repeat(server.password.length) ? "?" : "■";
            const buffer = "ˍ".repeat(server.password.length) + maskCharacter.repeat(server.password.length);
            const overwrittenBuffer = attempt.slice(0, buffer.length) + buffer.slice(attempt.length);

            const receivedBuffer = overwrittenBuffer.slice(0, server.password.length);
            const expectedValueBuffer = overwrittenBuffer.slice(server.password.length);

            if (receivedBuffer === expectedValueBuffer) {
                return { success: true, code: 200, message: "Success", data: undefined };
            }
            return fail(`auth failed: received '${receivedBuffer}', expected '${expectedValueBuffer}'`, `${receivedBuffer},${expectedValueBuffer}`);
        }
        case MODEL_IDS.globalMaxima: {
            const altitude = getKingOfTheHillAltitude(server, attempt);
            return fail(`current altitude: ${altitude.toFixed(5)} m; highest peak: 10,000 m`, `${altitude}`);
        }
        case MODEL_IDS.SortedEchoVuln: {
            if (server.password.length < 5 || attempt.length !== server.password.length) {
                return fail(server.staticPasswordHint, server.passwordHintData);
            }
            let squaredError = 0;
            for (let i = 0; i < attempt.length; i++) {
                const attemptedDigit = Number(attempt[i]);
                const actual = Number(server.password[i]);
                if (!Number.isFinite(attemptedDigit)) {
                    return fail(server.staticPasswordHint, server.passwordHintData);
                }
                squaredError += (attemptedDigit - actual) ** 2;
            }
            const rmsd = Math.sqrt(squaredError / attempt.length);
            return fail(server.staticPasswordHint, `${server.passwordHintData}; RMS Deviation:${rmsd.toFixed(3)}`);
        }
        case MODEL_IDS.packetSniffer:
            return fail(server.staticPasswordHint, capturePackets(server));
        default:
            return fail(server.staticPasswordHint, server.passwordHintData);
    }
}

// ---- labyrinth.ts ----
const WALL = "█";
const PATH = " ";
const NORTH = [0, -1];
const EAST = [1, 0];
const SOUTH = [0, 1];
const WEST = [-1, 0];
const MULTI_MAZE_THRESHOLD = 5;

function mazeMaker(setWidth, setHeight, rng) {
    const width = setWidth % 2 === 0 ? setWidth + 1 : setWidth;
    const height = setHeight % 2 === 0 ? setHeight + 1 : setHeight;
    const maze = Array.from({ length: height }, () => Array(width).fill(WALL));
    const stack = [[1, 1]];
    const directions = [NORTH, EAST, SOUTH, WEST];
    while (stack.length > 0) {
        const [x, y] = stack.pop();
        const neighbors = directions
            .map(([dx, dy]) => [x + dx * 2, y + dy * 2])
            .filter(([nx, ny]) => nx > 0 && nx < width && ny > 0 && ny < height && maze[ny][nx] === WALL);

        if (neighbors.length > 0) {
            stack.push([x, y]);
            const [nx, ny] = neighbors[Math.floor(rng() * neighbors.length)];
            maze[(y + ny) / 2][(x + nx) / 2] = PATH;
            maze[ny][nx] = PATH;
            stack.push([nx, ny]);
        }
    }
    return maze;
}

function generateMaze(width, height, rng) {
    if (width < MULTI_MAZE_THRESHOLD) {
        return mazeMaker(width, height, rng).map((row) => row.join(""));
    }

    const halfWidth = Math.ceil(width / 2);
    const halfHeight = Math.ceil(height / 2);

    const maze1 = mazeMaker(halfWidth, halfHeight, rng);
    const maze2 = mazeMaker(halfWidth, halfHeight, rng);
    const maze3 = mazeMaker(halfWidth, halfHeight, rng);
    const maze4 = mazeMaker(halfWidth, halfHeight, rng);

    const resultingMazeTopHalf = maze1.map((row, y) => row.slice(0, -1).concat(maze2[y]));
    const resultingMazeBottomHalf = maze3.map((row, y) => row.slice(0, -1).concat(maze4[y]));
    const resultingMaze = resultingMazeTopHalf.slice(0, -1).concat(resultingMazeBottomHalf);

    const subWidth = maze1[0].length - 1;
    const subHeight = maze1.length - 1;

    const randomTopGap = Math.floor((rng() * halfWidth) / 4) * 2 + 1;
    resultingMaze[randomTopGap][subWidth] = PATH;

    const randomLeftGap = Math.floor((rng() * halfHeight) / 4) * 2 + 1;
    resultingMaze[subHeight][randomLeftGap] = PATH;

    const randomBottomGap = (Math.floor((rng() * halfWidth) / 4) + 1) * 2;
    resultingMaze[height - randomBottomGap - 1][subWidth] = PATH;

    const randomRightGap = (Math.floor((rng() * halfHeight) / 4) + 1) * 2;
    resultingMaze[subHeight][width - randomRightGap - 1] = PATH;

    return resultingMaze.map((row) => row.join(""));
}

function getRandomOffset(offsetStartAndEnd, rng) {
    const offsetX = offsetStartAndEnd ? Math.floor(rng() * 3) * 2 : 0;
    const offsetY = offsetStartAndEnd ? Math.floor(rng() * 3) * 2 : 0;
    return [offsetX, offsetY];
}

export function makeLab(width, height, rng, offsetStartAndEnd) {
    const maze = generateMaze(width, height, rng);
    const [endOffsetX, endOffsetY] = getRandomOffset(offsetStartAndEnd, rng);
    const end = [maze[0].length - 2 - endOffsetX, maze.length - 2 - endOffsetY];
    const [startOffsetX, startOffsetY] = getRandomOffset(offsetStartAndEnd, rng);
    const start = [1 + startOffsetX, 1 + startOffsetY];
    return { maze, start, end };
}

export function getSurroundingsVisualized(maze, x, y, range = 1, showPlayer = false, showEnd = false, end = null) {
    const result = [];
    const [endX, endY] = end ?? [maze[0].length - 2, maze.length - 2];
    for (let i = y - range; i <= y + range; i++) {
        let row = "";
        for (let j = x - range; j <= x + range; j++) {
            if (i === y && j === x && showPlayer) {
                row += "@";
                continue;
            }
            if (showEnd && i === endY && j === endX) {
                row += "X";
                continue;
            }
            row += maze[i]?.[j] ?? PATH;
        }
        result.push(row);
    }
    return result.join("\n");
}

export function labReport(lab, pos) {
    const [x, y] = pos;
    const surroundings = getSurroundingsVisualized(lab.maze, x, y).split("\n");
    return {
        coords: [x, y],
        north: surroundings[0][1] === PATH,
        east: surroundings[1][2] === PATH,
        south: surroundings[2][1] === PATH,
        west: surroundings[1][0] === PATH,
    };
}

export function labRadar(lab, pos, range = 1) {
    return getSurroundingsVisualized(lab.maze, pos[0], pos[1], range, true, false);
}

function getOrdinalInput(input) {
    const word = input.toLowerCase().trim();
    if (["n", "north", "up"].includes(word)) return NORTH;
    if (["e", "east", "right"].includes(word)) return EAST;
    if (["s", "south", "down"].includes(word)) return SOUTH;
    if (["w", "west", "left"].includes(word)) return WEST;
    return null;
}

function getDirectionFromInput(input) {
    const direction = input.split(" ").map((word) => getOrdinalInput(word)).filter((d) => d);
    return direction[0] ?? [0, 0];
}

export function labStep(lab, pos, input) {
    const [x, y] = pos;
    const [dx, dy] = getDirectionFromInput(input);

    if (!dx && !dy) {
        return {
            code: 401,
            message: `You don't know how to do that. Try a command such as "go north"`,
            data: getSurroundingsVisualized(lab.maze, x, y, 1, true, false),
            pos,
        };
    }

    const potentialWall = [x + dx, y + dy];
    if (lab.maze[potentialWall[1]]?.[potentialWall[0]] !== PATH) {
        return {
            code: 401,
            message: `You cannot go that way. You are still at ${x},${y}.`,
            data: getSurroundingsVisualized(lab.maze, x, y, 1, true, false),
            pos,
        };
    }

    const newPos = [x + dx * 2, y + dy * 2];
    if (newPos[0] === lab.end[0] && newPos[1] === lab.end[1]) {
        return {
            code: 200,
            message: "You have successfully navigated the labyrinth! Congratulations",
            data: getSurroundingsVisualized(lab.maze, newPos[0], newPos[1], 1, true, false),
            pos: newPos,
        };
    }

    return {
        code: 401,
        message: `You have moved to ${newPos[0]},${newPos[1]}.`,
        data: getSurroundingsVisualized(lab.maze, newPos[0], newPos[1], 1, true, false),
        pos: newPos,
    };
}
