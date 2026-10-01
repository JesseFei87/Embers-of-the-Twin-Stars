"""Starfall v3 piano: clear, dynamic tactical-battle score, 40 bars / 100 BPM / 96 s.
Original composition, macOS piano instrument and synthesized percussion. Requires NumPy and Swift.
"""
from pathlib import Path
import json
import wave
import subprocess
import tempfile
import numpy as np

RATE, BPM, BARS = 24000, 100, 40
BEAT = 60 / BPM
BAR = 4 * BEAT
DURATION = BARS * BAR
N = round(DURATION * RATE)
rng = np.random.default_rng(17092)
dry = np.zeros((N, 2), dtype=np.float32)
send = np.zeros_like(dry)
piano_notes = []


def place(signal, start, level, pan=0, reverb=.0):
    # Keep every release across the seam instead of fading the whole loop to silence.
    idx = (round(start * RATE) + np.arange(len(signal))) % N
    voice = signal[:, None] * level * np.sqrt([(1 - pan) / 2, (1 + pan) / 2])
    dry[idx] += voice
    if reverb:
        send[idx] += voice * reverb


def envelope(t, attack, release):
    return np.minimum(1, t / attack) * np.minimum(1, (t[-1] - t) / release)


def piano(note, start, duration, velocity, channel):
    piano_notes.append(dict(time=max(0,start), duration=duration, pitch=note,
                            velocity=max(20,min(112,round(velocity))), channel=channel))


def pluck(note, start, level, pan=0, length=1.45):
    piano(note,start,.23,30+level*520,1)


def bass(note, start, level, length=.34):
    piano(note,start,length,30+level*230,2)


def strings(notes, start, length, level):
    # Rolled piano chord replaces the old continuous pad completely.
    for i,note in enumerate(notes):
        piano(note,start+i*.017,length*.65,26+level*1200,4)


def spiccato(note, start, level, pan):
    piano(note,start,.16,27+level*510,3)


def lead(note, start, beats, level, pan=.08, bright=False):
    # MIDI key velocity changes the piano's attack colour; no vibrato or reed sustain.
    piano(note,start,beats*BEAT*.92,38+level*390,0)


def drum(kind, start, level, pan=0):
    length = {'kick':.23,'snare':.19,'hat':.085,'tom':.24}[kind]
    t = np.arange(round(length*RATE))/RATE
    noise = rng.normal(0,1,len(t))
    if kind == 'kick':
        # Fast-decaying impact, with an audible upper click rather than sustained sub bass.
        phase = 2*np.pi*(72*t + 54*.022*(1-np.exp(-t/.022)))
        signal = np.sin(phase)*np.exp(-t/.062) + .07*noise*np.exp(-t/.009)
    elif kind == 'snare':
        high = np.concatenate(([0],np.diff(noise))) / 2
        signal = .32*np.sin(2*np.pi*190*t)*np.exp(-t/.035) + .32*high*np.exp(-t/.052)
    elif kind == 'hat':
        high = np.concatenate(([0],np.diff(noise))) / 2
        signal = .21*high*np.exp(-t/.017)
    else:
        signal = np.sin(2*np.pi*(170*t+13*.04*(1-np.exp(-t/.04))))*np.exp(-t/.075) + .055*noise*np.exp(-t/.025)
    place(signal*envelope(t,.002,.03),start,level*.5,pan)


# Minor intrigue -> major-colour hope -> strong dominant -> gentle suspended return.
voicings = {
 'Dm':(50,[62,65,69]), 'Bb':(46,[62,65,70]), 'Gm':(43,[62,67,70]),
 'As':(45,[62,64,69]), 'A':(45,[61,64,69]), 'F':(53,[60,65,69]), 'C':(48,[60,64,67]),
}
progression = ['Dm','Bb','Gm','As'] + ['Dm','Dm','Bb','C','Gm','Bb','As','A'] + ['Dm','C','Bb','As','Gm','Bb','As','A'] + ['Dm','Bb','F','C','Gm','Bb','As','A','Dm','Bb','C','A'] + ['Bb','F','Gm','As','Dm','Bb','Gm','As']

for bar, chord in enumerate(progression):
    start = bar*BAR
    root, notes = voicings[chord]
    if bar < 4:
        energy=.30; hits=[0,2.5]
    elif bar < 12:
        energy=.53; hits=[0,1.5,2.5]
    elif bar < 20:
        energy=.58+(bar-12)*.035; hits=[0,1.5,2,3.5]
    elif bar < 32:
        energy=.96 if bar>=24 else .89; hits=[0,1.5,2,3.5]
    else:
        energy=.58-(bar-32)*.042; hits=[0,2.5] if bar<36 else [0]
    strings(notes, start, BAR, .024*energy)
    for beat in hits:
        bass(root,start+beat*BEAT,.13*energy)
    arp_pattern=[0,2,1,2,0,1,2,1]
    for k in (range(8) if 4<=bar<34 else [0,3,6]):
        note=notes[arp_pattern[k]]+12
        pluck(note,start+(k*.5+.012*(k%2))*BEAT,.058*energy,-.42 if k%2 else .42)
    if 8<=bar<34:
        for k in range(8):
            note=notes[[0,0,2,1,0,2,1,2][k]]
            spiccato(note,start+k*.5*BEAT,.068*energy,-.26 if k%2 else .26)
    if 4<=bar<36:
        drum('kick',start,.20*energy)
        if bar>=12 and bar<32: drum('kick',start+2.5*BEAT,.13*energy)
        for beat in ([2] if bar<20 or bar>=32 else [1,3]):
            drum('snare',start+beat*BEAT,.19*energy,.12)
        for k in range(8):
            drum('hat',start+(k+.5)*.5*BEAT,.048*energy*(1 if k%2 else .7),-.35)
    if bar in [11,19,27,31]:
        for k in range(4):
            drum('tom',start+(3+k*.25)*BEAT,.072*(.7+k*.12),-.3+k*.2)

# A singable four-bar theme is introduced as fragments, then answered and expanded.
# Each list occupies four bars / sixteen beats. Notes are deliberately not continuous.
theme = [(0,74,1),(1.5,77,.5),(2,76,1),(3.5,74,.5),(5,69,1.5),(7,72,1),
         (8,74,1.5),(10,77,1),(11.5,79,.5),(12,76,2),(15,73,.7)]
answer = [(0,74,1.5),(2,77,1),(3.5,81,.5),(4,79,1.5),(6,77,1),(7.5,76,.5),
          (8,74,2),(11,70,1),(12,69,1.5),(14,73,1)]
climax = [(0,74,1),(1.5,77,.5),(2,81,1),(3.5,79,.5),(4,77,1.5),(6,74,1),
          (7.5,77,.5),(8,81,1.5),(10,84,1),(11.5,81,.5),(12,79,1.5),(14,76,1)]
resolve = [(0,79,1),(1.5,77,.5),(2,74,1.5),(4,77,2),(7,79,.8),
           (8,81,2),(11,79,1),(12,76,1.5),(14,73,1)]
for offset, phrase, level, bright in [(4,theme,.091,False),(8,answer,.096,False),
                                      (12,theme,.104,True),(16,answer,.111,True),
                                      (20,climax,.146,True),(24,resolve,.148,True),(28,climax,.139,True)]:
    for beat,note,length in phrase:
        lead(note,offset*BAR+beat*BEAT,length,level,bright=bright)
        if 24<=offset<32 and beat in [0,4,8,12]:
            lead(note-12,offset*BAR+beat*BEAT,length,.032,pan=-.18,bright=True)
# Opening and falling passage quote the same theme rather than adding a new melody each cycle.
for bar,note in [(0,74),(1,77),(2,74),(3,76),(32,77),(33,81),(34,79),(35,76),(36,74),(38,69),(39,76)]:
    lead(note,bar*BAR+.75*BEAT,1.6 if bar<36 else 1.0,.045 if bar<4 or bar>=36 else .067)

# Render the entire keyed performance through the installed acoustic grand piano.
# Keep the sound bank on the host; only the finished performance goes into the game.
with tempfile.TemporaryDirectory(prefix='starfall-piano-') as temp:
    score_path=Path(temp)/'score.json'
    render_path=Path(temp)/'piano.wav'
    score_path.write_text(json.dumps(dict(duration=DURATION,sampleRate=RATE,notes=piano_notes)))
    subprocess.run(['swift','-module-cache-path','/tmp/embers-swift-cache',
                    'scripts/render-piano.swift',str(score_path),str(render_path)],check=True)
    with wave.open(str(render_path),'rb') as rendered:
        assert rendered.getsampwidth()==2 and rendered.getnchannels()==2
        performance=np.frombuffer(rendered.readframes(rendered.getnframes()),dtype='<i2').reshape(-1,2).astype(np.float32)/32768
    performance[:len(performance)-N]+=performance[N:]
    performance=performance[:N]
    # Set piano to the front of the mix; percussion stays a restrained supporting layer.
    performance*=.105/np.sqrt(np.mean(performance**2))
    dry+=performance
    send+=performance*.28
    del performance

# Short stereo reflections on the melodic send only; drums and bass remain dry.
freq=np.fft.rfftfreq(N,1/RATE)
for channel in range(2):
    spectrum=np.fft.rfft(send[:,channel])
    spectrum*=freq**2/(freq**2+380**2)
    room=np.fft.irfft(spectrum,n=N).astype(np.float32)
    del spectrum
    for delay,strength in [(.043,.14),(.079,.09),(.127,.07),(.193,.05),(.283,.03),(.419,.02),(.617,.01)]:
        dry[:,channel]+=np.roll(room,round((delay+channel*.009)*RATE))*strength
    del room
del send
# Remove sub-energy and make space in the congested low-mid region, channel by channel.
response=(freq**4/(freq**4+52**4)) * (1-.22*np.exp(-.5*(np.log2(np.maximum(freq,1)/270)/.68)**2))
for channel in range(2):
    spectrum=np.fft.rfft(dry[:,channel]);spectrum*=response
    dry[:,channel]=np.fft.irfft(spectrum,n=N)
    del spectrum
mix=dry
mix-=mix.mean(axis=0)
mix*=min(.112/np.sqrt(np.mean(mix**2)),.82/np.max(abs(mix)))
pcm=np.round(mix*32767).astype('<i2')
out=Path('public/assets/audio/starfall-under-the-same-stars.wav')
with wave.open(str(out),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE);f.writeframes(pcm.tobytes())
# Aggregate windowed spectra without allocating another full-length stereo transform.
size=16384
power=np.zeros(size//2+1)
window=np.hanning(size)
for offset in range(0,N-size,size):
    power+=(abs(np.fft.rfft(mix[offset:offset+size]*window[:,None],axis=0))**2).sum(axis=1)
measure_freq=np.fft.rfftfreq(size,1/RATE)
bands={f'{lo}-{hi}Hz':round(float(power[(measure_freq>=lo)&(measure_freq<hi)].sum()/power.sum()),4)
       for lo,hi in [(0,100),(0,180),(180,450),(450,2000),(2000,12000)]}
sections=[('克制开场',0,4),('暗流推进',4,12),('逐步蓄势',12,20),('战斗高潮',20,32),('回落与希望',32,40)]
section_data=[]
for name,a,b in sections:
    section=mix[round(a*BAR*RATE):round(b*BAR*RATE)]
    section_data.append(dict(name=name,start=round(a*BAR,1),end=round(b*BAR,1),rmsDb=round(20*np.log10(np.sqrt(np.mean(section**2))),2)))
metadata=dict(title='同一片星光之下 · 钢琴战记',instrument='Acoustic grand piano',version=3,chapter='starfall-bridge',duration=DURATION,bpm=BPM,bars=BARS,
              key='D minor with major-colour hope',sampleRate=RATE,seamless=True,
              origin='Original score; piano rendered with macOS General MIDI acoustic grand; synthesized percussion',
              peakDb=round(20*np.log10(abs(mix).max()),2),rmsDb=round(20*np.log10(np.sqrt(np.mean(mix**2))),2),
              seamDelta=float(np.max(abs(mix[0]-mix[-1]))),spectrum=bands,sections=section_data)
Path('public/assets/audio/starfall-music.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2,default=float)+'\n')
print(json.dumps(metadata,ensure_ascii=False,indent=2,default=float))
