/* core/btlog.js — FileLogger2(.btlog) 이진 파서 (DOM 무관, 순수).
 * 포맷: 'BTCPP4-FileLogger2'(18) + protocol(1) + xml_size(int32 LE) + xml(UTF-8)
 *       + first_ts(int64 LE, usec) + [전이 9B: ts_usec(6,상대) uid(2) state(1)]...
 * ts 는 first_ts 기준 상대 → absolute epoch-us 환산(.db3 와 동일 단위, 병합 호환).
 * (bt_flow_check.py parse_btlog 와 1:1, 합성·실제 nav_single 26k전이로 동등성 검증됨) */
(function (BTV) {
  function parseBtlog(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder('utf-8');
    const magic = 'BTCPP4-FileLogger2';
    if (dec.decode(u8.subarray(0, magic.length)) !== magic)
      throw new Error('FileLogger2(.btlog) 파일이 아닙니다 (magic 불일치).');
    let p = magic.length + 1;                       // magic + protocol(1)
    const xmlSize = dv.getInt32(p, true); p += 4;
    const xmlText = dec.decode(u8.subarray(p, p + xmlSize)); p += xmlSize;
    const firstTs = Number(dv.getBigInt64(p, true)); p += 8;   // usec, 2^53 내 안전
    const n = Math.floor((u8.length - p) / 9), timeline = [];
    for (let k = 0; k < n; k++) {
      const off = p + k * 9;
      let tsRel = 0; for (let b = 5; b >= 0; b--) tsRel = tsRel * 256 + u8[off + b]; // 6B LE
      const uid = u8[off + 6] | (u8[off + 7] << 8);
      timeline.push([firstTs + tsRel, uid, u8[off + 8], 0]);
    }
    return { xmlText, firstTs, timeline };
  }
  BTV.core = BTV.core || {};
  BTV.core.parseBtlog = parseBtlog;
})(window.BTV = window.BTV || {});
