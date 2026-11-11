"""Mux page PCM and Playwright video using independently detected start/end markers."""
import json, math, os, subprocess as sp, hashlib, shutil
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
os.chdir(HERE)
def run(args):
    p=sp.run(args,stdout=sp.PIPE,stderr=sp.PIPE)
    if p.returncode: raise RuntimeError(p.stderr.decode(errors='replace')[-6000:])
    return p.stdout
def probe(p):return json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
def flashes(p):
    info=probe(p);v=next(s for s in info['streams'] if s['codec_type']=='video');fps=eval(v['avg_frame_rate'],{'__builtins__':{}})
    a=np.frombuffer(run(['ffmpeg','-v','error','-i',str(p),'-vf','crop=1280:500:0:0,scale=1:1:flags=area,format=gray','-f','rawvideo','-']),dtype=np.uint8)
    hits=np.where(a>245)[0];groups=[]
    for i in hits:
        if groups and i==groups[-1][-1]+1:groups[-1].append(int(i))
        else:groups.append([int(i)])
    short=[g for g in groups if len(g)<=8 and g[0]>1]
    if len(short)<2:raise RuntimeError(f'{p}: need two short white flashes; got {groups}')
    # All content has a dark background. The final two full-white bursts are sync.
    chosen=short[-2:]
    return [g[0]/fps for g in chosen],{'fps':fps,'flashFrames':[len(g) for g in chosen],'frameCount':len(a),'whiteGroups':groups}
def level(samples):
    return {'rms':float(np.sqrt(np.mean(samples.astype(np.float64)**2))),'peak':float(np.max(np.abs(samples))), 'samplesAtOrAbove1':int(np.count_nonzero(np.abs(samples)>=1))}
def decoded_audio(p):return np.frombuffer(run(['ffmpeg','-v','error','-i',str(p),'-vn','-ac','2','-ar','48000','-f','f32le','-']),dtype='<f4').reshape(-1,2)
def click_time(a,sr,expect,threshold):
    start=max(0,int((expect-.05)*sr));end=min(len(a),int((expect+.08)*sr));idx=np.where(np.max(np.abs(a[start:end]),axis=1)>threshold)[0]
    if not len(idx):raise RuntimeError(f'No click near {expect}')
    return (start+int(idx[0]))/sr
reports=[]
for path in sorted(Path('raw').glob('*.json')):
    if os.environ.get('TAKE') and not path.stem.startswith(os.environ['TAKE']):continue
    if path.stem.endswith('failure') or not Path(f'raw/{path.stem}.webm').exists():continue
    meta=json.loads(path.read_text());id=meta['id'];src=Path(f'raw/{id}.webm');out=Path(f'out/{id}.mp4')
    sr=meta['sr'];a=np.fromfile(f'raw/{id}.f32',dtype='<f4').reshape(-1,2)
    expected=[m['audio']-meta['origin'] for m in meta['markers']]
    at=[click_time(a,sr,t,.3) for t in expected]
    vt,frames=flashes(src)
    # Decode 32 bits: high byte 0x5a, low 24 bits = page audio clock in ms.
    stripe=np.frombuffer(run(['ffmpeg','-v','error','-i',str(src),'-vf','crop=128:6:0:0,format=gray','-f','rawvideo','-']),dtype=np.uint8).reshape(-1,6,128)
    bits=(stripe[:,2,2::4]>127).astype(np.uint32)
    codes=np.sum(bits*(np.uint32(1)<<np.arange(31,-1,-1,dtype=np.uint32)),axis=1,dtype=np.uint32)
    valid=(codes>>24)==0x5a
    times=(codes&0xffffff)/1000
    indices=np.where(valid)[0];stamps=times[valid]
    if len(indices)<20:raise RuntimeError(f'{id}: missing embedded frame clock')
    source_clock_reversals=int(np.count_nonzero(np.diff(stamps)<-.02))
    marker_indices=[round(t*frames['fps']) for t in vt]
    # Include the actually captured white frames at the audio time observed by rAF.
    for idx,m in zip(marker_indices,meta['markers']):
        before=np.where(valid[:idx])[0];after=np.where(valid[idx+1:])[0]+idx+1
        if not len(before) or not len(after) or not times[before[-1]]-.1<=m['flashAudio']<=times[after[0]]+.1:raise RuntimeError(f'{id}: captured flash does not bracket the page marker clock')
        indices=np.append(indices,idx);stamps=np.append(stamps,m['flashAudio'])
    order=np.argsort(stamps);indices=indices[order];stamps=stamps[order]
    absolute_start=meta['markers'][0]['audio']-.3
    astart=absolute_start-meta['origin']
    duration=math.ceil((meta['markers'][1]['audio']+.6-absolute_start)*25)/25
    grid=absolute_start+np.arange(round(duration*25))/25
    right=np.clip(np.searchsorted(stamps,grid),0,len(stamps)-1);left=np.maximum(0,right-1)
    choice=np.where(np.abs(stamps[left]-grid)<=np.abs(stamps[right]-grid),left,right)
    selected=indices[choice]
    # Each sync flash occupies exactly one output frame. Its position comes from
    # the captured frame's page-clock time, not an invented audio/video offset.
    for idx,m in zip(marker_indices,meta['markers']):
        slots=np.where(selected==idx)[0]
        for slot in slots:
            candidates=np.where(indices!=idx)[0];nearest=candidates[np.argmin(np.abs(stamps[candidates]-grid[slot]))];selected[slot]=indices[nearest]
        selected[round((m['flashAudio']-absolute_start)*25)]=idx
    frame_dir=Path(f'raw/frames/{id}');digest=hashlib.sha256(src.read_bytes()).hexdigest();cache_stamp=frame_dir/'.source-sha256'
    if frame_dir.exists() and (not cache_stamp.exists() or cache_stamp.read_text()!=digest):shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True,exist_ok=True)
    if not (frame_dir/'000000.jpg').exists():run(['ffmpeg','-y','-v','error','-i',str(src),'-fps_mode','passthrough','-q:v','2','-start_number','0',str(frame_dir/'%06d.jpg')])
    cache_stamp.write_text(digest)
    concat=Path(f'raw/{id}.ffconcat');concat.write_text('ffconcat version 1.0\n'+''.join(f"file '{(frame_dir/f'{int(i):06d}.jpg').resolve()}'\nduration 0.04\n" for i in selected))
    raw=level(a)
    music=a[int((at[0]+.1)*sr):int((at[1]-.1)*sr)];music_peak=float(np.max(np.abs(music)));gain=min(8,.70/max(music_peak,1e-9))
    end_sync=at[1]-at[0]+.3
    normalized=a*gain
    for marker_at in at:
        lo=max(0,int((marker_at-.07)*sr));hi=min(len(a),int((marker_at+.07)*sr));normalized[lo:hi]=a[lo:hi]*.8
    assert float(np.max(np.abs(normalized)))<.9
    normalized_path=Path(f'raw/{id}.normalized.f32');normalized.astype('<f4').tofile(normalized_path)
    af=f'atrim=start={astart},asetpts=PTS-STARTPTS,apad' 
    scale=(at[1]-at[0])/(vt[1]-vt[0])
    unique=np.unique(stamps[(stamps>=absolute_start)&(stamps<=absolute_start+duration)]);gaps=np.diff(unique)
    frame_clock={'sourceClockReversals':source_clock_reversals,'uniqueCapturedFrames':len(unique),'medianFrameGapMs':float(np.median(gaps)*1000),'maxFrameGapMs':float(np.max(gaps)*1000),'gapsOver80ms':int(np.count_nonzero(gaps>.08)),'framesReused':int(len(selected)-len(np.unique(selected))),'method':'Every output frame selected by its embedded page audio-clock stamp; no audio retiming'}
    video_filter='fps=25,format=yuv420p'
    # Flash hold time is intentional; exclude sync marker neighborhoods from render-gap flags.
    render_gaps=[float(b-a) for a,b in zip(unique[:-1],unique[1:]) if all(abs((a+b)/2-m['flashAudio'])>.20 for m in meta['markers'])]
    frame_clock['gapsOver80ms']=sum(g>.08 for g in render_gaps)
    frame_clock['maxRenderGapMs']=max(render_gaps,default=0)*1000
    if frame_clock['gapsOver80ms']:
        warning=f"CAPTURE: {frame_clock['gapsOver80ms']} frame gaps over 80 ms; max {frame_clock['maxRenderGapMs']:.0f} ms"
        video_filter+=f",drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text='{warning.replace(':',' -')}':x=20:y=555:fontsize=22:fontcolor=0xffe46a:box=1:boxcolor=black@0.85"
    if raw['peak']>1:
        warning=f"SOURCE BUS peak {raw['peak']:.3f} - export lowered to prevent clipping"
        video_filter+=f",drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text='{warning}':x=20:y=527:fontsize=21:fontcolor=0xffe46a:box=1:boxcolor=black@0.85"
    if id.startswith('01'):
        for event in meta['events']:
            release=event['release']['audio']-absolute_start
            tick=round(release*25)/25
            # The external release marker uses the trusted input clock rather
            # than the captured DOM overlay's one-or-two-frame paint delay.
            video_filter+=f",drawbox=x=480:y=8:w=240:h=56:color=0x101c2b:t=fill:enable='between(t,{tick},{tick+.36})'"
            video_filter+=f",drawbox=x=490:y=12:w=210:h=48:color=0xffe46a:t=fill:enable='between(t,{tick},{tick+.20})'"
            video_filter+=f",drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text='RELEASE':x=512:y=20:fontsize=30:fontcolor=0x101820:enable='between(t,{tick},{tick+.20})'"
    run(['ffmpeg','-y','-v','warning','-f','concat','-safe','0','-i',str(concat),'-f','f32le','-ar',str(sr),'-ac','2','-i',str(normalized_path),'-map','0:v:0','-map','1:a:0','-vf',video_filter,'-af',af,'-c:v','libopenh264','-b:v','1600k','-maxrate','2100k','-bufsize','3200k','-g','50','-c:a','aac','-b:a','160k','-ar','48000','-t',str(duration),'-movflags','+faststart',str(out)])
    vfinal,finfo=flashes(out);final=decoded_audio(out);e=[.3,at[1]-at[0]+.3];afinal=[click_time(final,48000,t,.2) for t in e];residual=[(y-x)*1000 for x,y in zip(vfinal,afinal)]
    import struct
    boxes=[]
    with out.open('rb') as f:
        while (header:=f.read(8)):
            size,kind=struct.unpack('>I4s',header);boxes.append(kind.decode('ascii',errors='replace'))
            if size==1:size=struct.unpack('>Q',f.read(8))[0];f.seek(size-16,1)
            elif size>=8:f.seek(size-8,1)
            else:break
    assert boxes.index('moov')<boxes.index('mdat')
    info=probe(out);streams=info['streams'];v=next(s for s in streams if s['codec_type']=='video');audio=next(s for s in streams if s['codec_type']=='audio');levels=level(final)
    report={'id':id,'file':str(out.resolve()),'lengthSeconds':float(info['format']['duration']),'sizeBytes':out.stat().st_size,'syncMs':residual,'inputOffsetMs':[(x-y)*1000 for x,y in zip(vt,at)],'videoTimeScale':scale,'rawAudio':raw,'gain':gain,'markerGain':0.8,'musicSourcePeak':music_peak,'musicSourceRms':level(music)['rms'],'audio':levels,'video':{'codec':v['codec_name'],'pix_fmt':v['pix_fmt'],'width':v['width'],'height':v['height'],'duration':float(v['duration']),'fps':v['avg_frame_rate']},'audioCodec':audio['codec_name'],'audioDuration':float(audio['duration']),'captureFrames':frames,'frameClock':frame_clock,'outputFrames':finfo,'errors':meta['errors'],'events':meta.get('events',[]),'renderMetrics':meta.get('renderMetrics'),'densityStages':{k:meta[k] for k in ['rawDensity','aggregateDensity','zoomDensity'] if k in meta},'sampleRate':sr,'reportedBaseLatencyMs':meta['baseLatency']*1000,'reportedOutputLatencyMs':meta['outputLatency']*1000,'failedResponses':meta.get('failedResponses',[]),'releaseMarkerMode':'burned from trusted pointer release audio-clock log' if id.startswith('01') else 'captured page overlay'}
    if id.startswith('03'):
        triggers=sorted([t for t in meta['gesture']['triggers'] if t['voice']=='melody'],key=lambda t:t['target'])
        gaps=[b['target']-a['target'] for a,b in zip(triggers[:-1],triggers[1:])]
        report['dragLogSummary']={'melodyTriggers':len(triggers),'gapsBelow125ms':sum(.0001<=g<.124 for g in gaps),'simultaneousOnsets':sum(abs(g)<.0001 for g in gaps),'lateDispatches':sum(t['target']<t['audioNow'] for t in triggers),'droppedNotes':'undetermined: score changes throughout drag'}
    if meta['kind']=='rooms' and meta['errors'] and all('404 (Not Found)' in e for e in meta['errors']):report['consoleNote']='The reproduced missing resources were /favicon.ico; audio and font assets loaded. See ../network.log.'
    assert v['codec_name']=='h264' and audio['codec_name']=='aac' and v['pix_fmt']=='yuv420p'
    assert out.stat().st_size<15_000_000 and 20<=duration<=60
    assert abs(float(v['duration'])-float(audio['duration']))<.05
    assert level(music)['rms']>.0001
    assert levels['rms']>.001 and levels['peak']<1 and levels['samplesAtOrAbove1']==0
    if max(map(abs,residual))>=40:raise RuntimeError(f'{id}: A/V sync exceeds 40 ms; must fix or caption before delivery')
    if id.startswith('01'):
        pixels=np.frombuffer(run(['ffmpeg','-v','error','-i',str(out),'-vf','crop=2:2:500:25,format=rgb24','-f','rawvideo','-']),dtype=np.uint8).reshape(-1,4,3).mean(axis=1)
        yellow=(pixels[:,0]>180)&(pixels[:,1]>140)&(pixels[:,2]<150)
        starts=np.where(yellow&~np.r_[False,yellow[:-1]])[0]/25
        visual=[]
        for event in meta['events']:
            expect=event['release']['audio']-absolute_start
            nearest=float(starts[np.argmin(np.abs(starts-expect))])
            visual.append({'gesture':event['title'],'visualMinusReleaseMs':(nearest-expect)*1000})
        report['releaseTickAlignment']=visual
        if any(abs(e['visualMinusReleaseMs'])>39.9 for e in visual):report['warning']='A release tick differs from its logged release by at least 40 ms'
    reports.append(report);Path(f'out/{id}.metrics.json').write_text(json.dumps(report,indent=2));print(id,round(duration,2),'sync',residual,'levels',levels,flush=True)
    run(['ffmpeg','-y','-v','error','-ss','7','-i',str(out),'-frames:v','1',f'raw/{id}-frame.png'])
# Half-speed replay of exactly the first turn and pitch segment of take 01.
first=next((r for r in reports if r['id']=='01-gesture-delay'),None)
if first:
    meta=json.loads(Path('raw/01-gesture-delay.json').read_text());a0=meta['markers'][0]['audio']-.3
    ev=meta['events'][:2];start=ev[0]['start']['audio']-a0-.8;end=ev[1]['release']['audio']-a0+4.2
    start=math.floor(start*25)/25;end=math.ceil(end*25)/25
    out=Path('out/02-gesture-delay-slowed.mp4');duration=round((end-start)*2,2)
    # Start/end flash-click sentinels are copied from the independently aligned take.
    # 0.8 seconds of each is retained at normal speed; content is slowed, pitch one octave lower.
    src='out/01-gesture-delay.mp4';sourceDuration=first['lengthSeconds'];tail=sourceDuration-.8
    filters=[f'[0:v]split=3[v0][v1][v2]',f'[v0]trim=0:0.8,setpts=PTS-STARTPTS[vh]',f'[v1]trim={start}:{end},setpts=2*(PTS-STARTPTS),fps=25[vc]',f'[v2]trim=start={tail},setpts=PTS-STARTPTS[vt]',f'[0:a]asplit=3[a0][a1][a2]',f'[a0]atrim=0:0.8,asetpts=PTS-STARTPTS[ah]',f'[a1]atrim={start}:{end},asetpts=PTS-STARTPTS,asetrate=24000,aresample=48000[ac]',f'[a2]atrim=start={tail},asetpts=PTS-STARTPTS[at]','[vh][ah][vc][ac][vt][at]concat=n=3:v=1:a=1[v][a]']
    # The bar explicitly labels release and first changed target in the slowed timeline.
    overlay='[v]drawbox=x=0:y=585:w=1280:h=135:color=0x08111a:t=fill,drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text=\'2 · Half speed replay — pitch one octave lower\':x=25:y=596:fontsize=30:fontcolor=0xb9ffe1,drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text=\'Yellow = release    Mint = first changed note target\':x=25:y=638:fontsize=25:fontcolor=white,drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text=\'Measured engine targets; same turn and pitch gestures as video 1\':x=25:y=677:fontsize=19:fontcolor=white'
    for event in ev:
        release=.8+(event['release']['audio']-a0-start)*2;changed=.8+(event['target']-a0-start)*2;begin=release-1.2;finish=changed+1.5
        overlay+=f",drawbox=x=40:y=535:w=1200:h=36:color=0x203347:t=fill:enable='between(t,{begin},{finish})'"
        for t,c in [(release,'0xffe46a'),(changed,'0x85f8db')]:
            x=40+(t-begin)/(finish-begin)*1200
            overlay+=f",drawbox=x={x}:y=535:w=6:h=36:color={c}:t=fill:enable='between(t,{begin},{finish})'"
        overlay+=f",drawtext=fontfile=/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf:text='|':x='40+1200*(t-{begin})/({finish}-{begin})':y=526:fontsize=42:fontcolor=white:enable='between(t,{begin},{finish})'"
    overlay+='[vo]';filters.append(overlay)
    run(['ffmpeg','-y','-v','warning','-i',src,'-filter_complex',';'.join(filters),'-map','[vo]','-map','[a]','-r','25','-fps_mode','cfr','-c:v','libopenh264','-b:v','1600k','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(out)])
    vf,fi=flashes(out);fa=decoded_audio(out);p=probe(out);lvl=level(fa)
    # Locate clicks from normal-speed intro/end, unaffected by the slowed section.
    ats=[click_time(fa,48000,v,.2) for v in vf];sync=[(a-v)*1000 for a,v in zip(ats,vf)]
    r={'id':'02-gesture-delay-slowed','file':str(out.resolve()),'lengthSeconds':float(p['format']['duration']),'sizeBytes':out.stat().st_size,'syncMs':sync,'audio':lvl,'videoTimeScale':2,'pitch':'one octave lower in replay; sync sentinels remain normal speed','source':'01-gesture-delay.mp4','sourceTrim':[start,end],'events':ev,'errors':[],'outputFrames':fi,'video':{'codec':'h264','pix_fmt':'yuv420p','width':1280,'height':720},'audioCodec':'aac'}
    streams=p['streams'];v=next(s for s in streams if s['codec_type']=='video');au=next(s for s in streams if s['codec_type']=='audio');r['video']['duration']=float(v['duration']);r['audioDuration']=float(au['duration']);assert abs(float(v['duration'])-float(au['duration']))<.05
    assert 20<=r['lengthSeconds']<=60 and r['sizeBytes']<15_000_000 and lvl['peak']<1
    if max(map(abs,sync))>=40:raise RuntimeError('02: sync exceeds 40 ms; must fix or caption')
    reports.append(r);Path('out/02-gesture-delay-slowed.metrics.json').write_text(json.dumps(r,indent=2));print(r['id'],r['syncMs'],lvl,flush=True)
if not os.environ.get('TAKE'):Path('out/measurements.json').write_text(json.dumps(sorted(reports,key=lambda r:r['id']),indent=2))

if not os.environ.get('TAKE'):exec(Path('write_index.py').read_text())
