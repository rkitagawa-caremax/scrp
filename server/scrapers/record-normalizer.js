import { PREFECTURES } from '../utils/prefectures.js';

const FIELD_CANDIDATES = {
    prefecture: [
        '都道府県',
        '都道府県名',
        '所在地都道府県',
        '都道府県コード',
        '所在地（都道府県）',
        'prefecture',
        'pref',
    ],
    jigyoushoNumber: [
        '事業所番号',
        '指定事業所番号',
        '介護保険事業所番号',
        '事業所コード',
        'jigyoushoNumber',
        'jigyousho_number',
        'businessNumber',
        'business_number',
        'facilityCode',
    ],
    name: [
        '事業所の名称',
        '事業所名',
        '事業所名称',
        '施設名',
        '名称',
        'name',
    ],
    postalCode: [
        '郵便番号',
        '〒',
        'postcode',
        'postalCode',
        'zip',
    ],
    address: [
        '事業所の所在地',
        '事業所所在地',
        '住所',
        '所在地',
        'address',
    ],
    phone: [
        '電話番号',
        '電話',
        'TEL',
        'tel',
        'phone',
    ],
    fax: [
        'FAX番号',
        'FAX',
        'ＦＡＸ番号',
        'ファックス番号',
        'fax',
    ],
    serviceType: [
        'サービス種別',
        'サービス種類',
        'serviceType',
    ],
    corporateName: [
        '法人の名称',
        '法人名',
        '運営法人名',
        '法人名称',
        'corporateName',
    ],
    corporateType: [
        '法人の種別',
        '法人種別',
        '法人区分',
        'corporateType',
    ],
    userCount: [
        '利用者人数',
        '利用者数',
        'TotalUserNum',
        'totalUserNum',
        'userCount',
        'user_count',
    ],
};

const KEY_NORMALIZE_PATTERN =
    /[\s\u3000_\-\/\\()（）［］\[\]{}「」『』【】:：・･.,，。]/g;

const MERGE_FIELDS = [
    'prefecture',
    'jigyoushoNumber',
    'name',
    'postalCode',
    'address',
    'phone',
    'fax',
    'serviceType',
    'corporateName',
    'corporateType',
    'userCount',
    'sourceSite',
];

function normalizeKey(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(KEY_NORMALIZE_PATTERN, '');
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function buildLookup(record) {
    const lookup = new Map();
    for (const [key, value] of Object.entries(record || {})) {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) continue;
        if (!lookup.has(normalizedKey)) {
            lookup.set(normalizedKey, []);
        }
        const normalizedValue = normalizeText(value);
        if (normalizedValue) {
            lookup.get(normalizedKey).push(normalizedValue);
        }
    }
    return lookup;
}

function getFirstValue(values) {
    if (!values || values.length === 0) return '';
    return values.find((v) => normalizeText(v)) || '';
}

function findValueFromLookup(lookup, candidates) {
    for (const candidate of candidates) {
        const key = normalizeKey(candidate);
        const exact = getFirstValue(lookup.get(key));
        if (exact) return exact;
    }

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeKey(candidate);
        for (const [key, values] of lookup.entries()) {
            if (
                key.includes(normalizedCandidate) ||
                normalizedCandidate.includes(key)
            ) {
                const partial = getFirstValue(values);
                if (partial) return partial;
            }
        }
    }

    return '';
}

function extractField(record, fieldName) {
    const candidates = FIELD_CANDIDATES[fieldName] || [];
    if (candidates.length === 0) return '';
    const lookup = buildLookup(record);
    return findValueFromLookup(lookup, candidates);
}

function normalizePostalCode(value) {
    const text = normalizeText(value);
    const match = text.match(/(\d{3})-?(\d{4})/);
    if (!match) return text;
    return `${match[1]}-${match[2]}`;
}

function normalizePhone(value) {
    const text = normalizeText(value).replace(/[―ー－]/g, '-');
    const hyphenated = text.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
    if (hyphenated) return hyphenated[0];

    const digits = text.replace(/\D/g, '');
    if (/^0\d{9,10}$/.test(digits)) return digits;
    return text;
}

function normalizeJigyoushoNumber(value) {
    const digits = normalizeText(value).replace(/\D/g, '');
    if (!digits) return '';
    return digits;
}

function normalizeUserCount(value) {
    return normalizeText(value).replace(/\D/g, '');
}

function inferPrefecture(address) {
    const normalizedAddress = normalizeText(address);
    if (!normalizedAddress) return '';
    const match = PREFECTURES.find((pref) =>
        normalizedAddress.startsWith(pref.name)
    );
    return match ? match.name : '';
}

export function filterRecordsByPrefecture(records, selectedPrefs) {
    if (!selectedPrefs || selectedPrefs.length === 0) return records;

    const prefNames = selectedPrefs.map((pref) => pref.name);
    const prefCodes = new Set(selectedPrefs.map((pref) => pref.code));

    return records.filter((record) => {
        const prefValue = extractField(record, 'prefecture');
        if (prefNames.some((prefName) => prefValue.includes(prefName))) {
            return true;
        }

        const numberValue = normalizeJigyoushoNumber(
            extractField(record, 'jigyoushoNumber')
        );
        if (numberValue.length >= 2 && prefCodes.has(numberValue.slice(0, 2))) {
            return true;
        }

        const addressValue = extractField(record, 'address');
        if (prefNames.some((prefName) => addressValue.startsWith(prefName))) {
            return true;
        }

        const allText = Object.values(record || {})
            .map((value) => normalizeText(value))
            .join(' ');

        return prefNames.some((prefName) => allText.includes(prefName));
    });
}

export function mapToStandardFormat(records, serviceTypeName, options = {}) {
    const sourceSite = normalizeText(options.sourceSite);

    return records
        .map((record) => {
            const address = extractField(record, 'address');
            const prefecture =
                extractField(record, 'prefecture') || inferPrefecture(address);

            return {
                prefecture,
                jigyoushoNumber: normalizeJigyoushoNumber(
                    extractField(record, 'jigyoushoNumber')
                ),
                name: extractField(record, 'name'),
                postalCode: normalizePostalCode(extractField(record, 'postalCode')),
                address,
                phone: normalizePhone(extractField(record, 'phone')),
                fax: normalizePhone(extractField(record, 'fax')),
                serviceType:
                    extractField(record, 'serviceType') || serviceTypeName || '',
                corporateName: extractField(record, 'corporateName'),
                corporateType: extractField(record, 'corporateType'),
                userCount: normalizeUserCount(extractField(record, 'userCount')),
                sourceSite,
            };
        })
        .filter(
            (item) =>
                item.name ||
                item.address ||
                item.jigyoushoNumber ||
                item.phone ||
                item.fax ||
                item.userCount
        );
}

function buildDedupeKey(item) {
    if (item.jigyoushoNumber) {
        return `num:${item.jigyoushoNumber}`;
    }

    const fallbackParts = [
        normalizeKey(item.prefecture),
        normalizeKey(item.name),
        normalizeKey(item.address),
        normalizeKey(item.serviceType),
    ];
    return `fallback:${fallbackParts.join('|')}`;
}

function mergeSourceSite(current, incoming) {
    const values = new Set();
    for (const value of [current, incoming]) {
        const text = normalizeText(value);
        if (!text) continue;
        text.split(',').forEach((part) => {
            const normalized = normalizeText(part);
            if (normalized) values.add(normalized);
        });
    }
    return [...values].join(', ');
}

function pickBetterValue(currentValue, nextValue) {
    const current = normalizeText(currentValue);
    const next = normalizeText(nextValue);
    if (!current) return next;
    if (!next) return current;
    return next.length > current.length ? next : current;
}

export function dedupeRecords(records) {
    const deduped = new Map();

    for (const record of records || []) {
        const key = buildDedupeKey(record);
        if (!deduped.has(key)) {
            deduped.set(key, { ...record });
            continue;
        }

        const existing = deduped.get(key);
        const merged = { ...existing };

        for (const field of MERGE_FIELDS) {
            if (field === 'sourceSite') {
                merged.sourceSite = mergeSourceSite(
                    existing.sourceSite,
                    record.sourceSite
                );
                continue;
            }
            merged[field] = pickBetterValue(existing[field], record[field]);
        }

        deduped.set(key, merged);
    }

    return [...deduped.values()];
}
