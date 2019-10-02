Vue.use(VueResource);

class Peptide {
    constructor(sequence, ratio, charge, segment, link, src, index) {
        this.sequence = sequence;
        this.ratio = ratio;
        this.charge = charge;
        this.segment = segment;
        this.src = src;
        this.link = link;
        this.annotate = null;
    }
}

class Sequence {
    constructor(sequence, index, ipi='', symbol='', peptides=[]) {
        this.sequence = sequence;
        this.index = index;
        this.ipi = ipi;
        this.symbol = symbol;
        this.peptides = peptides;
    }

    addPeptide(peptide) {
        this.peptides.push(peptide);
    }

    /**
     * Utility function which checks if any of the peptides associated with this sequence have ratios of 20.
     * @return {Boolean}
     */
    has20s() {
        for (let peptide of this.peptides) {
            if (peptide.ratio === '20') {
                return true;
            }
        }

        return false;
    }
}

class SequenceDataset {
    constructor() {
        this.sequences = [];
    }

    getPeptide(sequenceIndex, peptideIndex) {
        return this.sequences[sequenceIndex].peptides[peptideIndex];
    }

    /**
     * Initialize SequenceDataset from combined_dta.txt file
     * @param  {String} dtaText Raw contents of combined_dta.txt
     */
    initFromDta(dtaText) {
        let lines = dtaText.split('\n');
        let headers = lines.shift().split('\t');

        this.sequences = [];

        for (let i = 0, n = lines.length; i < n; i++) {
            let line = lines[i].split('\t');

            // we have a new sequence entry since id is non empty
            // otherwise we add a peptide to the current sequence
            if (line[0].trim()) {
                var sequence = new Sequence(line[4], line[0]);
                this.sequences.push(sequence);
            } else if (line.length > 1) {
                if (!sequence.ipi) {
                    sequence.ipi = line[1];
                    sequence.description = line[2];
                    sequence.symbol = line[3];
                }

                let linkSplit = line[11].split(',');

                sequence.addPeptide(new Peptide(    
                    line[4], line[6], line[9], line[10], linkSplit[1].split('"')[1], linkSplit[0].split('"')[1]
                ));
            }
        }
    }

    syncAnnotations(url) {
        url = url.replace('.txt', '.html');

        let annotationSet = {
            file: url,
            '_id': url,
            annotations: []
        };

        // only look at sequences that contain 20s
        let subset = this.sequences.filter((sequence) => sequence.has20s());

        for (let sequence of subset) {
            for (let peptide of sequence.peptides) {
                if (peptide.annotate === false) {
                    annotationSet.annotations.push({
                        link: peptide.link,
                        sequence: peptide.sequence,
                        charge: peptide.charge,
                        segment: peptide.segment,
                        ipi: sequence.ipi,
                        symbol: sequence.symbol,
                        index: sequence.index
                    });
                }
            }
        }

        // generate combined_dta.txt.annotated
        jQuery.ajax({
            type: 'POST',
            url: '/cgi-bin/radu/annotate.py',
            data: JSON.stringify(annotationSet)
        });

        // save to mongodb for persistance
        jQuery.ajax({
            url: '/annotate',    
            data: {
                'data': JSON.stringify(annotationSet)
            }
        });
    }
}

var app = new Vue({
    el: '#app',
    data: {
        // this is now a newline delimited list of urts
        datasetUrl: '',
        dataset_idx: 0,
        datasets: [],
        dataset: new SequenceDataset(),
        sequenceIndex: 0,
        peptideIndex: -1
    },
    methods: {
        get20s: function(event) {
            this.datasets = this.datasetUrl.split('\n').filter(Boolean).map(v => v.trim());
            
            this.$http.get(this.datasets[this.dataset_idx]).then(function(response) {
                this.dataset.initFromDta(response.data);
                this.dataset.sequences = this.dataset.sequences.filter((sequence) => sequence.has20s());
                this.nextPeptide();
            });

            event.target.blur();
        },
        /**
         * Return class to apply to peptide display depending on status.
         * @param  {Peptide} peptide Peptide object being operated on
         * @param  {Number} index   Index of current peptide
         * @return {String}         Class to apply to peptide row.
         */
        getPeptideClass: function(peptide, index) {
            return {
                disabled: peptide.ratio != 20,
                activePeptide: index === this.peptideIndex,
                positive: peptide.annotate,
                negative: peptide.annotate === false
            }
        },
        good: function() {
            this.dataset.getPeptide(this.sequenceIndex, this.peptideIndex).annotate = true;
            this.nextPeptide();
        },
        bad: function() {
            this.dataset.getPeptide(this.sequenceIndex, this.peptideIndex).annotate = false;
            this.nextPeptide();
        },
        skip: function() {
            this.nextPeptide();
        },
        previousSequence: function() {
            if (this.sequenceIndex > 0) {
                this.sequenceIndex--;
                this.peptideIndex = this.dataset.sequences[this.sequenceIndex].peptides.findIndex((el) => el.ratio == 20);
            }
        },
        nextSequence: function() {
            if (this.sequenceIndex < this.dataset.sequences.length - 1) {
                this.sequenceIndex++;
                this.peptideIndex = this.dataset.sequences[this.sequenceIndex].peptides.findIndex((el) => el.ratio == 20);
            } else {
                this.dataset.syncAnnotations(this.datasets[this.dataset_idx]);

                // If we have more datasets entered, load the next one
                if (this.dataset_idx < this.datasets.length) {
                    this.sequenceIndex = 0;
                    this.peptideIndex = -1;
                    this.dataset = new SequenceDataset();
                    this.dataset_idx++;
                    this.get20s();
                }
            }
        },
        previousPeptide: function() {
            const peptides = this.dataset.sequences[this.sequenceIndex].peptides;
            // find index of next peptide with a ratio of 20
            let nextIndex = peptides.findIndex((el, i) => i < this.peptideIndex && el.ratio == 20);

            if (nextIndex === -1) {
                this.previousSequence();
            } else {
                this.peptideIndex = nextIndex;
            }
        },
        nextPeptide: function() {
            const peptides = this.dataset.sequences[this.sequenceIndex].peptides;
            // find index of next peptide with a ratio of 20
            let nextIndex = peptides.findIndex((el, i) => i > this.peptideIndex && el.ratio == 20);

            if (nextIndex === -1) {
                this.nextSequence();
            } else {
                this.peptideIndex = nextIndex;
            }
        }
    },
    computed: {
        getChromatogramUrl: function() {
            let split = this.datasets[this.dataset_idx].split('/');
            let suffix = this.dataset.sequences[this.sequenceIndex].peptides[this.peptideIndex].src;
            split.splice(-1, 1, suffix);
            return split.join('/');
        }
    },
    mounted: function() {
        // binding global event listeners for keyboard shortcuts
        window.addEventListener('keyup', (event) => {
            switch (event.key) {
                case 'ArrowUp':
                    this.previousPeptide();
                    break;
                case 'ArrowDown':
                    this.skip();
                    break;
                case 'ArrowLeft':
                    this.bad();
                    break;
                case 'ArrowRight':
                    this.good();
                    break;
            }
        });

        // hijack arrow keys, prevent viewport navigation
        const arrowEvents = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

        window.addEventListener('keydown', (event) => {
            if (arrowEvents.includes(event.key)) {
                event.preventDefault();
            }
        });

        // manually patching in touch events
        var hammer = new Hammer(this.$el);
        hammer.on('swipeleft', (event) => this.bad());
        hammer.on('swiperight', (event) => this.good());
    }
});
