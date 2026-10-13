#!/usr/bin/env python3
"""선수단 사진(Commons) 중 "얼굴이 제대로 나온 사진"만 쓰도록 판정해 roster-photo-faces.json 에 기록한다(2026-10-13 "얼굴나온사진으로").

Wikidata P18 사진은 전신샷·경기 장면이 섞여 있어 원형 아바타에서 몸통만 보이는 경우가 있다. 이 스크립트는 OpenCV Haar 정면 얼굴 검출로
 - 얼굴이 하나도 안 잡히거나
 - 얼굴이 너무 작거나(이미지 폭의 18% 미만 = 전신·원경)
 - 얼굴 중심이 원형 아바타(중앙 정사각 크롭) 밖이면
부적합(0)으로 기록한다. 키는 사진 URL(사진이 바뀌면 재판정). TheSportsDB 컷아웃·ESPN 헤드샷은 원래 얼굴 사진이라 대상이 아니다.
요청 예절: User-Agent 명시, 직렬 + 간격, 429/403 즉시 중단. 판정 결과는 apply-photo-face-veto.mjs 가 샤드에서 ph 를 제거하는 데 쓴다.
"""
import json, os, sys, time, glob, urllib.request, urllib.error

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'roster-photo-faces.json')
BUDGET = int(os.environ.get('FACE_BUDGET', '600'))
DELAY = float(os.environ.get('FACE_DELAY_S', '1.5'))
UA = 'ShadeSideBot/1.0 (https://github.com/janetyoon85/shadowstadium-data; janetyoon85@gmail.com) face-check'
MIN_FACE_FRAC = 0.18

_cascades = [cv2.CascadeClassifier(cv2.data.haarcascades + n) for n in ('haarcascade_frontalface_alt2.xml', 'haarcascade_frontalface_default.xml')]


def judge(img_bytes):
    """(ok, detail) — 얼굴이 아바타(중앙 정사각 크롭)에 충분한 크기로 들어오면 True."""
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return False, 'decode'
    h, w = img.shape
    gray = cv2.equalizeHist(img)
    side = min(w, h)
    x0, y0 = (w - side) // 2, (h - side) // 2  # cover 크롭 영역
    best = None
    for cc in _cascades:
        faces = cc.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(max(16, int(w * 0.10)),) * 2)
        for (fx, fy, fw, fh) in faces:
            cx, cy = fx + fw / 2, fy + fh / 2
            inside = x0 <= cx <= x0 + side and y0 <= cy <= y0 + side and fy >= y0 - fh * 0.2 and fy + fh <= y0 + side + fh * 0.2
            if inside and (best is None or fw > best):
                best = fw
        if best:
            break
    if not best:
        return False, 'noface'
    frac = best / side
    return (frac >= MIN_FACE_FRAC), f'face={frac:.2f}'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def main():
    faces = {}
    if os.path.exists(OUT):
        faces = json.load(open(OUT, encoding='utf-8'))
    urls = []
    seen = set()
    for f in sorted(glob.glob(os.path.join(ROOT, 'team-rosters', '*.json'))):
        data = json.load(open(f, encoding='utf-8'))
        for lst in data.values():
            if not isinstance(lst, list):
                continue
            for p in lst:
                u = p.get('ph')
                if u and 'commons.wikimedia.org' in u and u not in faces and u not in seen:
                    seen.add(u)
                    urls.append(u)
    print(f'[faces] known={len(faces)} todo={len(urls)} budget={BUDGET}')
    done = ok = 0
    stop = ''
    fails = 0
    for u in urls:
        if done >= BUDGET:
            break
        try:
            body = fetch(u)
        except urllib.error.HTTPError as e:
            if e.code in (429, 403):
                stop = f'HTTP {e.code} — 즉시 중단'
                break
            if e.code == 404:
                faces[u] = 0  # 파일이 사라짐 → 사진 제거
                done += 1
                continue
            fails += 1
            if fails >= 5:
                stop = f'연속 HTTP {e.code}'
                break
            time.sleep(DELAY * 2)
            continue
        except Exception:
            fails += 1
            if fails >= 5:
                stop = '연속 네트워크 실패'
                break
            time.sleep(DELAY * 2)
            continue
        fails = 0
        good, detail = judge(body)
        faces[u] = 1 if good else 0
        ok += 1 if good else 0
        done += 1
        if done % 100 == 0:
            json.dump(faces, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
            print(f'[faces] {done}/{BUDGET} ok={ok}')
        time.sleep(DELAY)
    json.dump(faces, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'[faces] done={done} ok={ok} rejected={done - ok}{" STOP: " + stop if stop else ""}')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        for u in sys.argv[2:]:
            print(u.split('/')[-1][:50], judge(fetch(u)))
            time.sleep(DELAY)
    else:
        main()
