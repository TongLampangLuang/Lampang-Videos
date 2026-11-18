/**
 * TLL Auto-Fetch: สคริปต์ดึงคลิปลำปางใหม่เข้าคลังวิดีโออัตโนมัติ
 * ทำงานผ่าน GitHub Actions (ตั้งเวลาทุกคืน)
 * รองรับทั้ง YouTube RSS Feeds (ฟรี ไม่ต้องใช้ API Key) และ YouTube API v3
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const VIDEOS_FILE = path.join(__dirname, '..', 'videos.json');

// รายการช่องเป้าหมาย (YouTube RSS Feeds)
// สามารถเพิ่ม channel_id หรือ playlist_id ได้เรื่อยๆ
const RSS_FEEDS = [
  // หากมี channel_id เพิ่มเติมสามารถใส่ในนี้ได้
  // ตัวอย่าง: { name: 'โต้งลำปางหลวง', channelId: 'UCxxxxxxxx' }
];

// คำค้นหาลำปางสำหรับ YouTube API (กรณีผู้ใช้ใส่ YOUTUBE_API_KEY ใน GitHub Secrets)
const SEARCH_QUERIES = [
  'ลำปาง',
  'เที่ยวลำปาง',
  'ประวัติศาสตร์ลำปาง',
  'กาดโต้งลำปางหลวง',
  'ของกินลำปาง'
];

function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let data = '';
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchHttps(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ฟังก์ชันวิเคราะห์อำเภอจากชื่อคลิป
function detectDistrict(title) {
  const t = title || '';
  if (/เกาะคา/i.test(t)) return 'อ.เกาะคา';
  if (/แม่เมาะ/i.test(t)) return 'อ.แม่เมาะ';
  if (/เถิน/i.test(t)) return 'อ.เถิน';
  if (/แจ้ห่ม|แจ้ซ้อน/i.test(t)) return 'อ.แจ้ห่ม';
  if (/งาว/i.test(t)) return 'อ.งาว';
  if (/ห้างฉัตร/i.test(t)) return 'อ.ห้างฉัตร';
  if (/วังเหนือ/i.test(t)) return 'อ.วังเหนือ';
  if (/สบปราบ/i.test(t)) return 'อ.สบปราบ';
  if (/แม่พริก/i.test(t)) return 'อ.แม่พริก';
  if (/เสริมงาม/i.test(t)) return 'อ.เสริมงาม';
  if (/แม่ทะ/i.test(t)) return 'อ.แม่ทะ';
  if (/เมืองปาน/i.test(t)) return 'อ.เมืองปาน';
  if (/เมืองลำปาง|กองต้า|สบตุ๋ย|เขลางค์/i.test(t)) return 'อ.เมืองลำปาง';
  return 'ทั่วจังหวัดลำปาง';
}

// ฟังก์ชันวิเคราะห์หมวดหมู่อัตโนมัติ
function detectCategory(title) {
  const t = title || '';
  if (/มีด|เซรามิค|ชามตราไก่|จักสาน|ผ้าทอ|ช่าง|แอ็บข้าว|ภูมิปัญญา/i.test(t)) {
    return { category: 'craft_wisdom', categoryLabel: 'ช่างฝีมือ & ภูมิปัญญา' };
  }
  if (/กิน|กาด|ตลาด|อาหาร|ข้าวซอย|ขนมจีน|แคบหมู|ลาบ|วิถี/i.test(t)) {
    return { category: 'food_lifestyle', categoryLabel: 'ของกิ๋น & วิถีชุมชน' };
  }
  if (/ประวัติ|ตำนาน|วัด|พระธาตุ|สงกรานต์|ตานก๋วยสลาก|ล้านนา|โบราณ/i.test(t)) {
    return { category: 'history_culture', categoryLabel: 'ตำนานเมือง & ประเพณี' };
  }
  return { category: 'places_travel', categoryLabel: 'เที่ยวลำปาง & แลนด์มาร์ก' };
}

// แปลงวันที่เป็น พ.ศ.
function getYearBE(dateStr) {
  if (!dateStr) return new Date().getFullYear() + 543;
  const d = new Date(dateStr);
  return d.getFullYear() + 543;
}

// ดึงผ่าน YouTube Data API v3 (ถ้ามี API Key)
async function fetchViaYouTubeApi(apiKey, existingIds) {
  const newVideos = [];
  console.log('⚡ Checking YouTube Data API v3...');

  for (const q of SEARCH_QUERIES) {
    try {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&order=date&maxResults=15&key=${apiKey}`;
      const searchRes = JSON.parse(await fetchHttps(searchUrl));

      if (!searchRes.items || !searchRes.items.length) continue;

      const videoIds = searchRes.items
        .map(it => it.id && it.id.videoId)
        .filter(id => id && !existingIds.has(id));

      if (!videoIds.length) continue;

      // ดึงรายละเอียดเชิงลึก (views, duration)
      const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}&key=${apiKey}`;
      const detailRes = JSON.parse(await fetchHttps(detailUrl));

      for (const item of (detailRes.items || [])) {
        if (existingIds.has(item.id)) continue;

        const sn = item.snippet || {};
        const st = item.statistics || {};
        const cd = item.contentDetails || {};

        const views = parseInt(st.viewCount, 10) || 0;
        const pubDate = sn.publishedAt ? sn.publishedAt.slice(0, 10) : '';
        const catInfo = detectCategory(sn.title);
        const district = detectDistrict(sn.title);

        const newVid = {
          id: item.id,
          title: sn.title || '',
          channel: sn.channelTitle || 'YouTube',
          isTong: /โต้งลำปางหลวง/i.test(sn.channelTitle || ''),
          isTongCultural: /โต้งลำปางหลวง/i.test(sn.channelTitle || ''),
          category: catInfo.category,
          categoryLabel: catInfo.categoryLabel,
          district: district,
          length: cd.duration || 'วิดีโอ',
          durationSec: 0,
          formatType: 'clip',
          viewCount: views,
          views: views.toLocaleString('th-TH') + ' ครั้ง',
          publishDate: pubDate,
          yearCE: pubDate ? parseInt(pubDate.slice(0, 4), 10) : new Date().getFullYear(),
          yearBE: getYearBE(pubDate),
          thumb: (sn.thumbnails && (sn.thumbnails.high || sn.thumbnails.medium || sn.thumbnails.default) || {}).url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
          summary: sn.description ? sn.description.slice(0, 150) + '...' : '',
          timestamps: [],
          score: /โต้งลำปางหลวง/i.test(sn.channelTitle || '') ? 200 : 120
        };

        newVideos.push(newVid);
        existingIds.add(item.id);
        console.log(`+ เพิ่มคลิปใหม่: "${newVid.title}" (${newVid.channel})`);
      }
    } catch (e) {
      console.warn(`Error searching query "${q}":`, e.message);
    }
  }

  return newVideos;
}

// ดึงผ่าน YouTube RSS Feed สาธารณะ (ฟรี 100%)
async function fetchViaRss(feedUrl, existingIds) {
  const newVideos = [];
  try {
    const xml = await fetchHttps(feedUrl);
    // Regex ดึง entry
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    for (const entry of entryMatches) {
      const idMatch = entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const authorMatch = entry.match(/<name>([\s\S]*?)<\/name>/);
      const pubMatch = entry.match(/<published>([\s\S]*?)<\/published>/);

      if (!idMatch || !titleMatch) continue;
      const ytid = idMatch[1].trim();
      if (existingIds.has(ytid)) continue;

      const title = titleMatch[1].trim();
      const channel = authorMatch ? authorMatch[1].trim() : 'ลำปาง';
      const pubDate = pubMatch ? pubMatch[1].trim().slice(0, 10) : '';
      const catInfo = detectCategory(title);
      const district = detectDistrict(title);

      const newVid = {
        id: ytid,
        title: title,
        channel: channel,
        isTong: /โต้งลำปางหลวง/i.test(channel),
        isTongCultural: /โต้งลำปางหลวง/i.test(channel),
        category: catInfo.category,
        categoryLabel: catInfo.categoryLabel,
        district: district,
        length: 'วิดีโอ',
        durationSec: 0,
        formatType: 'clip',
        viewCount: 100,
        views: 'คลิปใหม่',
        publishDate: pubDate,
        yearCE: pubDate ? parseInt(pubDate.slice(0, 4), 10) : new Date().getFullYear(),
        yearBE: getYearBE(pubDate),
        thumb: `https://i.ytimg.com/vi/${ytid}/hqdefault.jpg`,
        summary: title,
        timestamps: [],
        score: /โต้งลำปางหลวง/i.test(channel) ? 200 : 120
      };

      newVideos.push(newVid);
      existingIds.add(ytid);
      console.log(`+ [RSS] เพิ่มคลิปใหม่: "${newVid.title}" (${newVid.channel})`);
    }
  } catch (err) {
    console.warn(`Error fetching RSS ${feedUrl}:`, err.message);
  }
  return newVideos;
}

async function main() {
  console.log('🚀 เริ่มต้นการตรวจสอบคลิปลำปางใหม่...');

  if (!fs.existsSync(VIDEOS_FILE)) {
    console.error('ไม่พบไฟล์ videos.json');
    process.exit(1);
  }

  const rawData = fs.readFileSync(VIDEOS_FILE, 'utf8');
  const videos = JSON.parse(rawData);
  console.log(`คลังปัจจุบันมีทั้งหมด: ${videos.length} คลิป`);

  const existingIds = new Set(videos.map(v => v.id));
  let newlyAdded = [];

  // 1. ตรวจสอบจาก YouTube API v3 ถ้ามี Key
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    const apiVideos = await fetchViaYouTubeApi(apiKey, existingIds);
    newlyAdded = newlyAdded.concat(apiVideos);
  } else {
    console.log('ℹ️ ไม่พบ YOUTUBE_API_KEY (หากต้องการให้ค้นหาคลิปใหม่ทั่ว YouTube อัตโนมัติ สามารถใส่ Key ใน GitHub Secrets ได้ครับ)');
  }

  // 2. ตรวจสอบจาก RSS Feeds
  for (const feed of RSS_FEEDS) {
    const feedUrl = feed.channelId 
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${feed.channelId}`
      : feed.playlistId 
      ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${feed.playlistId}`
      : null;
    if (feedUrl) {
      const rssVideos = await fetchViaRss(feedUrl, existingIds);
      newlyAdded = newlyAdded.concat(rssVideos);
    }
  }

  if (newlyAdded.length > 0) {
    // เอาคลิปใหม่ใส่ไว้บนสุด
    const updatedVideos = [...newlyAdded, ...videos];
    fs.writeFileSync(VIDEOS_FILE, JSON.stringify(updatedVideos, null, 2), 'utf8');
    console.log(`✅ อัปเดตสำเร็จ! เพิ่มคลิปใหม่เข้าไป ${newlyAdded.length} คลิป รวมเป็น ${updatedVideos.length} คลิป`);
  } else {
    console.log('✨ ไม่มีคลิปใหม่ในรอบนี้ (คลังคลิปอัปเดตเป็นปัจจุบันแล้ว)');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
